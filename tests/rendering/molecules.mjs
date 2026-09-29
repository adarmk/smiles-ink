// Molecules whose automatic 2D layout is hard, plus simple controls.
// SMILES are PubChem isomeric SMILES unless noted.
export const CONTROLS = [
  ["aspirin", "CC(=O)OC1=CC=CC=C1C(=O)O"],
  ["caffeine", "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"],
  ["ibuprofen", "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O"],
  ["cholesterol", "C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C"],
  ["erythromycin", "CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O"],
];

// Third field: the defect score of the current layout (see score.ts). Tests fail if a
// change makes any of these worse; lower them when layouts improve.
export const HARD = [
  ["morphine", "CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O", 10.87],
  ["naltrexone", "C1CC1CN2CC[C@]34[C@@H]5C(=O)CC[C@]3([C@H]2CC6=C4C(=C(C=C6)O)O5)O", 11.42],
  ["naltrindole", "C1CC1CN2CC[C@]34[C@@H]5C6=C(C[C@]3([C@H]2CC7=C4C(=C(C=C7)O)O5)O)C8=CC=CC=C8N6", 17.71],
  ["buprenorphine", "CC(C)(C)[C@](C)([C@H]1C[C@@]23CC[C@]1([C@H]4[C@@]25CCN([C@@H]3CC6=C5C(=C(C=C6)O)O4)CC7CC7)OC)O", 18.41],
  ["levorphanol", "CN1CC[C@]23CCCC[C@H]2[C@H]1CC4=C3C=C(C=C4)O", 11.91],
  ["dextromethorphan", "CN1CC[C@@]23CCCC[C@@H]2[C@@H]1CC4=C3C=C(C=C4)OC", 10.9],
  ["strychnine", "C1CN2CC3=CCO[C@H]4CC(=O)N5[C@H]6[C@H]4[C@H]3C[C@H]2[C@@]61C7=CC=CC=C75", 7.41],
  ["quinine", "COC1=CC2=C(C=CN=C2C=C1)[C@H]([C@@H]3C[C@@H]4CCN3C[C@@H]4C=C)O", 1.1],
  ["cubane", "C12C3C4C1C5C2C3C45", 25.51],
  ["adapalene", "COC1=C(C=C(C=C1)C2=CC3=C(C=C2)C=C(C=C3)C(=O)O)C45CC6CC(C4)CC(C6)C5", 17.22],
  ["paclitaxel", "CC1=C2[C@H](C(=O)[C@@]3([C@H](C[C@@H]4[C@]([C@H]3[C@@H]([C@@](C2(C)C)(C[C@@H]1OC(=O)[C@@H]([C@H](C5=CC=CC=C5)NC(=O)C6=CC=CC=C6)O)O)OC(=O)C7=CC=CC=C7)(CO4)OC(=O)C)O)C)OC(=O)C", 12.93],
  ["cyclosporin", "CC[C@H]1C(=O)N(CC(=O)N([C@H](C(=O)N[C@H](C(=O)N([C@H](C(=O)N[C@H](C(=O)N[C@@H](C(=O)N([C@H](C(=O)N([C@H](C(=O)N([C@H](C(=O)N([C@H](C(=O)N1)[C@@H]([C@H](C)C/C=C/C)O)C)C(C)C)C)CC(C)C)C)CC(C)C)C)C)C)CC(C)C)C)C(C)C)CC(C)C)C)C", 1.49],
  // Hypothetical bivalent ligand: two 6β-naltrexamine units joined by a PEG3 diamide.
  // Bivalent ligand: a 14-hydroxymorphinan-fused quinoline and naltrindole
  // joined by an ether/amide linker (reconstructed from a user screenshot).
  ["bivalent morphinan-quinoline/naltrindole", "CN1CC[C@@]23Cc4nc5ccc(OCCOCC(=O)NCCCCCCCCNC(=O)COCC(=O)Nc6cccc7c8c([nH]c67)[C@@H]6Oc7c(O)ccc9c7[C@@]67CCN(CC6CC6)[C@H](C9)[C@]7(O)C8)cc5cc4C[C@@]2(O)[C@H]1Cc1ccc(O)cc13", 34.63],
  ["bivalent naltrexamine-PEG", "C1CC1CN2CC[C@]34[C@@H]5[C@@H](CC[C@]3([C@H]2CC6=C4C(=C(C=C6)O)O5)O)NC(=O)CCOCCOCCOCCC(=O)N[C@H]7CC[C@@]8(O)[C@H]9Cc%10ccc(O)c%11O[C@@H]7[C@]8(c%10%11)CCN9CC%12CC%12", 34.71],
];
