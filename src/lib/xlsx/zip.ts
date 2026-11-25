/**
 * Leitor ZIP mínimo, só o necessário para abrir planilhas .xlsx (OOXML).
 *
 * Existe para não trazer dependência nova: lê o diretório central, aceita os
 * métodos "stored" (0) e "deflate" (8) e confere o CRC-32 de cada entrada.
 *
 * Planilha pode vir de upload (importação de tabela contratual), então os
 * limites protegem contra zip bomb: número de entradas, tamanho descompactado
 * por entrada e total. ZIP64 e arquivos cifrados são recusados.
 */
import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipLimits {
  /** Quantidade máxima de entradas no diretório central. */
  maxEntries: number;
  /** Bytes descompactados por entrada. */
  maxEntryBytes: number;
  /** Bytes descompactados somando todas as entradas lidas. */
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 4_000,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

interface CentralEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD tem 22 bytes + comentário de até 65.535 bytes.
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new ZipFormatError('arquivo não é um ZIP válido (fim do diretório central ausente)');
}

/** Arquivo ZIP aberto: lista os nomes e lê entradas sob os limites. */
export class ZipArchive {
  private readonly entries = new Map<string, CentralEntry>();
  private totalRead = 0;

  constructor(
    private readonly buf: Buffer,
    private readonly limits: ZipLimits = DEFAULT_ZIP_LIMITS,
  ) {
    if (buf.length < 22) throw new ZipFormatError('arquivo pequeno demais para ser ZIP');
    const eocd = findEndOfCentralDirectory(buf);
    const count = buf.readUInt16LE(eocd + 10);
    const centralSize = buf.readUInt32LE(eocd + 12);
    const centralOffset = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || centralSize === ZIP64_MARKER || centralOffset === ZIP64_MARKER) {
      throw new ZipFormatError('ZIP64 não é suportado');
    }
    if (count > limits.maxEntries) {
      throw new ZipFormatError(`ZIP com ${count} entradas excede o limite de ${limits.maxEntries}`);
    }
    if (centralOffset + centralSize > eocd) {
      throw new ZipFormatError('diretório central fora dos limites do arquivo');
    }

    let p = centralOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) {
        throw new ZipFormatError('entrada do diretório central corrompida');
      }
      const flags = buf.readUInt16LE(p + 8);
      const method = buf.readUInt16LE(p + 10);
      const crc = buf.readUInt32LE(p + 16);
      const compressedSize = buf.readUInt32LE(p + 20);
      const uncompressedSize = buf.readUInt32LE(p + 24);
      const nameLength = buf.readUInt16LE(p + 28);
      const extraLength = buf.readUInt16LE(p + 30);
      const commentLength = buf.readUInt16LE(p + 32);
      const localHeaderOffset = buf.readUInt32LE(p + 42);
      if (
        compressedSize === ZIP64_MARKER ||
        uncompressedSize === ZIP64_MARKER ||
        localHeaderOffset === ZIP64_MARKER
      ) {
        throw new ZipFormatError('ZIP64 não é suportado');
      }
      const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
      this.entries.set(name, {
        name,
        method,
        flags,
        crc,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
      p += 46 + nameLength + extraLength + commentLength;
    }
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Conteúdo descompactado da entrada, ou `null` se ela não existir. */
  read(name: string): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    if ((entry.flags & 0x1) !== 0) throw new ZipFormatError(`entrada cifrada: ${name}`);
    if (entry.uncompressedSize > this.limits.maxEntryBytes) {
      throw new ZipFormatError(`entrada ${name} excede o limite de tamanho`);
    }
    if (this.totalRead + entry.uncompressedSize > this.limits.maxTotalBytes) {
      throw new ZipFormatError('conteúdo descompactado excede o limite total');
    }

    const h = entry.localHeaderOffset;
    if (h + 30 > this.buf.length || this.buf.readUInt32LE(h) !== LOCAL_SIGNATURE) {
      throw new ZipFormatError(`cabeçalho local corrompido: ${name}`);
    }
    const start = h + 30 + this.buf.readUInt16LE(h + 26) + this.buf.readUInt16LE(h + 28);
    const end = start + entry.compressedSize;
    if (end > this.buf.length) throw new ZipFormatError(`dados fora do arquivo: ${name}`);
    const raw = this.buf.subarray(start, end);

    let data: Buffer;
    if (entry.method === 0) {
      data = Buffer.from(raw);
    } else if (entry.method === 8) {
      try {
        // `maxOutputLength` interrompe a descompressão de uma bomba antes de
        // alocar a memória toda; o tamanho declarado no diretório pode mentir.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(entry.uncompressedSize, 1) });
      } catch (error) {
        throw new ZipFormatError(`não foi possível descompactar ${name}: ${String(error)}`);
      }
    } else {
      throw new ZipFormatError(`método de compressão ${entry.method} não suportado (${name})`);
    }

    if (data.length !== entry.uncompressedSize) {
      throw new ZipFormatError(`tamanho descompactado divergente em ${name}`);
    }
    if (crc32(data) >>> 0 !== entry.crc >>> 0) {
      throw new ZipFormatError(`CRC-32 divergente em ${name}`);
    }
    this.totalRead += data.length;
    return data;
  }
}
