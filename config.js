// Configuração do app Memórias. Nada aqui é segredo: o clientId é um identificador público.
window.CONFIG = {
  clientId: '990526ee-4b32-4c3d-9e81-a1f921f8efa9',
  // "consumers" = contas pessoais da Microsoft (OneDrive pessoal).
  authority: 'https://login.microsoftonline.com/consumers',
  scopes: ['Files.ReadWrite'],
  // Pasta do OneDrive onde os registros são gravados (pode ser alterada em Ajustes).
  pastaBase: 'Família/Memórias/Registros',
  // Dias após o registro em que cada revisão fica disponível:
  // 8 revisões em 2 semanas, depois reforços em 1 e 3 meses.
  agenda: [0, 1, 2, 4, 6, 9, 12, 14, 30, 90],
  // A revisão do "dia 0" só aparece algumas horas depois do registro.
  horasMinimasDia0: 3
};
