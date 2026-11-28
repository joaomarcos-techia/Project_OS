import type { SVGProps } from 'react';

/**
 * Só o "Q" da marca (anel + cauda), para o quadrado azul do menu do app da
 * clínica. `currentColor`: quem usa decide a cor (branco sobre o azul).
 * Decorativo — o nome acessível fica no link que o contém.
 *
 * Arquivo separado de `logo.tsx` de propósito: um teste compara os traços de
 * lá, um a um, com o logo do e-mail de cadastro.
 */
export function QoroMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="-6 -6 884 884"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M588 775C588 794 569 804 514 815C470 823 400 824 356 816C301 807 232 779 183 748C139 719 79 657 60 621C56 613 48 598 42 588C29 565 14 526 6 491C-2 456 -2 362 6 328C23 263 46 214 83 167C197 22 394 -36 576 22C622 37 654 52 691 77C767 129 823 201 851 284C867 330 870 350 870 413C870 466 869 477 860 506C845 564 817 617 786 647C776 657 771 660 761 660C750 660 745 657 720 633C686 600 685 594 707 557C735 511 746 468 746 409C746 348 730 296 697 248C683 228 644 189 624 175C602 159 558 138 526 129C489 118 426 114 384 120C314 131 248 164 202 212C118 300 99 430 154 543C210 655 340 723 473 708C508 704 508 704 524 713C542 723 588 768 588 775Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M837 802C843 826 827 856 804 865C790 871 764 871 754 866C742 860 410 543 405 532C395 516 399 489 412 476C434 455 464 452 490 467C515 483 834 791 837 802Z"
      />
    </svg>
  );
}
