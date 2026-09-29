# Backup e transformação da aba cadastrada

## Escopo

Uma cópia criptografada por usuário, substituída apenas após gravação bem-sucedida,
expira em sete dias. Não cria abas no Google Sheets. Nome e ID da aba continuam
vinculados ao usuário. Não é uma cópia integral do arquivo Google Drive.

## Restauráveis

- Valores e fórmulas originais de todas as células do intervalo lido, incluindo
  linhas agrupadas/ocultas; notas, links simples e texto rico, formatos e validações.
- Mesclagens, formatação condicional, dimensões, congelamento, grade e ocultação.
- Grupos de linhas/colunas, hierarquia, estado recolhido e posição dos controles.
- Filtro básico e visualizações de filtro sobre intervalos da própria aba.
- Cores alternadas e gráficos ancorados na aba com fontes locais.
- Proteções de aba inteira são mantidas no lugar, não recriadas. Alterações de
  permissões desde o backup bloqueiam a restauração; permissão atual é obrigatória.

## Bloqueios / limites

Continuam bloqueados: tabelas estruturadas, tabelas dinâmicas, fontes conectadas,
chips, imagens em células quando detectadas, segmentações, metadados personalizados,
comentários quando expostos pela API, proteções parciais/com exceções, recursos com
referências a outras abas ou intervalos nomeados. Até 2.000 linhas, 100 colunas,
32 MB antes de compressão. A cópia anterior não é removida em caso de falha.

A API não oferece uma cópia integral de scripts, histórico, compartilhamentos,
imagens/desenhos flutuantes e comentários do arquivo. A interface explicita essa
limitação. Fórmulas são copiadas, mas suas dependências externas não são copiadas.
Identificadores de gráficos/filtros/faixas são mantidos; se houver conflito após
movimentação para outra aba, o lote do Google falha atomicamente, sem apagamento.

## Troca de design

Lê inclusive dados ocultos. Reconhece um ou mais blocos com os cabeçalhos normais
e especiais já suportados, incluindo blocos históricos repetidos, e mantém a
ordem dos dados. Não altera datas/valores literais de entrada. Não adivinha
cabeçalhos ambíguos, não converte fórmulas de entrada em valores e não descarta
publicações por falta de capacidade.

Cada bloco identificado conserva um cabeçalho no novo design; os blocos antigos
não são misturados ao atual. Linhas vazias intermediárias são compactadas, mantendo
a ordem e o pareamento das publicações normais/especiais. O último bloco recebe
60 linhas de capacidade por seção, incluindo as já preenchidas (não 60 extras).
Se já houver mais de 60 linhas ocupadas, mantém todas e informa a ampliação na
conferência. Histórico e cabeçalhos são dimensionados à parte, até 2.000 linhas
no total; acima disso a transformação é bloqueada sem descartar dados.
As fórmulas e validações do modelo são estendidas até a última linha, preservando
as referências absolutas, o teto de 35.000 e a regra das primeiras 75 publicações.
Isso não cria um novo limite de recompensa ou altera a sincronização normal.

O modelo substitui fórmulas/estilo/colunas. Grupos, filtros, cores alternadas e
gráficos antigos não são reaproveitados após remapear as colunas. A conferência
mostra contagens de publicações, blocos, fórmulas substituídas, recursos removidos
e células extras (até 20 endereços). Confirmação explícita e impressão digital
atualizada são exigidas. Backup continua manual, nunca automático.

## Verificação

Testes locais cobrem quatro modelos, blocos repetidos recolhidos, grupos aninhados,
ordem de remoção/recriação, escopo da própria aba, bloqueios, criptografia,
permissões, confirmação e alterações entre prévia/aplicação. Não executar uma
restauração ou transformação na planilha real do usuário só para testar.

Referências: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request
e https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets
