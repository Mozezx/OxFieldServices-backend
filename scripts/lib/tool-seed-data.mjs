/** Metadados das ferramentas de exemplo + URL remota para importar para o Storage. */

export const CAT = {
  MEDICAO: 'a1000001-0000-4000-8000-000000000001',
  CORTE: 'a1000002-0000-4000-8000-000000000002',
  ELETRICA: 'a1000003-0000-4000-8000-000000000003',
  EPI: 'a1000004-0000-4000-8000-000000000004',
  ELEVACAO: 'a1000005-0000-4000-8000-000000000005',
};

/** @type {{ id: string; name: string; categoryId: string; sourceImageUrl: string }[]} */
export const TOOL_SEED = [
  {
    id: 'b2000001-0000-4000-8000-000000000001',
    name: 'Trena laser 30 m',
    categoryId: CAT.MEDICAO,
    sourceImageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/9/91/Handheld_laser_distance_meter.jpg',
  },
  {
    id: 'b2000002-0000-4000-8000-000000000002',
    name: 'Nível a laser cruzado',
    categoryId: CAT.MEDICAO,
    sourceImageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Laser_line_level.jpg',
  },
  {
    id: 'b2000003-0000-4000-8000-000000000003',
    name: 'Martelo de borracha 500 g',
    categoryId: CAT.CORTE,
    sourceImageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Rubber_mallet.jpg',
  },
  {
    id: 'b2000004-0000-4000-8000-000000000004',
    name: 'Parafusadeira sem fio 18 V',
    categoryId: CAT.CORTE,
    sourceImageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/39/Cordless_drill.jpg',
  },
  {
    id: 'b2000005-0000-4000-8000-000000000005',
    name: 'Multímetro digital CAT III',
    categoryId: CAT.ELETRICA,
    sourceImageUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Digital_multimeter.jpg',
  },
  {
    id: 'b2000006-0000-4000-8000-000000000006',
    name: 'Detector de tensão sem contacto',
    categoryId: CAT.ELETRICA,
    sourceImageUrl: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?auto=format&fit=max&w=1200&q=80',
  },
  {
    id: 'b2000007-0000-4000-8000-000000000007',
    name: 'Capacete de segurança EN 397',
    categoryId: CAT.EPI,
    sourceImageUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e8/Yellow_hard_hat.jpg',
  },
  {
    id: 'b2000008-0000-4000-8000-000000000008',
    name: 'Arnês antiqueda com talabarte',
    categoryId: CAT.EPI,
    sourceImageUrl:
      'https://images.unsplash.com/photo-1522163182402-834f871fd851?auto=format&fit=max&w=1200&q=80',
  },
  {
    id: 'b2000009-0000-4000-8000-000000000009',
    name: 'Talha manual corrente 1 t',
    categoryId: CAT.ELEVACAO,
    sourceImageUrl:
      'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?auto=format&fit=max&w=1200&q=80',
  },
  {
    id: 'b2000010-0000-4000-8000-000000000010',
    name: 'Carrinho de mão painel reforçado',
    categoryId: CAT.ELEVACAO,
    sourceImageUrl: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Wheelbarrow.jpg',
  },
];
