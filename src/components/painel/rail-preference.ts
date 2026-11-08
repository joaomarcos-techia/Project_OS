/**
 * Preferência "Fixar menu aberto" do app da clínica.
 *
 * Vive no `<html data-qoro-rail="pinned">` e no `localStorage`, não em estado
 * React: o CSS do trilho lê o atributo, e o script abaixo o aplica ANTES da
 * pintura (mesmo padrão do tema). Sem isso, quem fixou o menu veria a tela
 * nascer com o trilho de 44 px e pular 172 px para o lado na hidratação.
 *
 * Arquivo sem `'use client'` de propósito: o layout raiz (servidor) importa o
 * script; o hook que o lê fica em `use-rail-pinned.ts`.
 */
export const RAIL_STORAGE_KEY = 'qoro-rail';
export const RAIL_ATTRIBUTE = 'data-qoro-rail';
export const RAIL_PINNED = 'pinned';

export const RAIL_INIT = `try{if(localStorage.getItem('${RAIL_STORAGE_KEY}')==='${RAIL_PINNED}'){document.documentElement.setAttribute('${RAIL_ATTRIBUTE}','${RAIL_PINNED}')}}catch(e){}`;
