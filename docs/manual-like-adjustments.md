# Ajuste manual de curtidas

- Admin → Usuários → Buscar pelo nome → Liberar ajuste manual. Negado por padrão, liberação/revogação individual com motivo e auditoria privada.
- Usuário autorizado: engrenagem ao lado de Atualizar minha planilha. Necessita acesso ao Sheets e período aberto; quantidade inteira de 0 a 1.000.000 e chave ativar/desativar.
- Quantidade por período, distribuída de modo pseudoaleatório e determinístico entre publicações ativas elegíveis. Repetir atualização não acumula. Desativar preserva a quantidade configurada, mas retira os extras do cálculo; próxima sincronização restaura os valores reais na planilha.
- As métricas originais nunca são substituídas no banco. Painel e CG calculado identificam os extras. Relatórios, exportações, classificação e histórico mantêm os valores reais. Novo período inicia sem ajuste.
- Sheets recebe total real + manual, cabeçalho explícito e nota detalhada por célula, preservando notas preexistentes. Se o mês/colunas impedirem aplicar o total completo, não há escrita parcial. Permissão e período são revalidados antes da escrita atômica.

## Verificações

- Testes de distribuição, desativação/revogação, repetição, duplicidade, datas, planilha e busca sem acentos.
- Testes SQL em transação com ROLLBACK: admin, auto-liberação negada, isolamento entre usuários, motivo, auditoria, salvamento, período inválido, quantidade inválida e revogação. Nenhum ajuste/liberação real foi mantido.
- Navegador local isolado: janela em desktop e celular, salvar 150, reabrir com valor preservado, revogação durante edição, busca `jose` encontra somente José Teste. Sem erros de navegador observados.
- Build de produção e TypeScript aprovados. Nenhuma planilha real foi escrita durante os testes; o transporte real do Google Sheets precisa ser confirmado na primeira sincronização autorizada.
- Revisão React: componentes clientes isolados, diálogo nativo com foco/teclado, tratamento de erro, bloqueio de duplo salvamento, cálculos derivados sem mutar posts.

## Segurança

RLS e funções SECURITY INVOKER limitam configuração ao dono autorizado e ao período aberto. Auditoria privada é gravada por trigger protegido. O aviso informativo [RLS sem política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) na auditoria é intencional: clientes não têm acesso. Alertas preexistentes de [funções SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) e [proteção de senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) não foram alterados por esta entrega.

## Retorno seguro

Em caso de problema, retornar o código à publicação anterior `e45c408`; as tabelas novas são aditivas e podem permanecer sem uso. Não apagar tabelas de ajustes nem auditoria. Bloquear a permissão individual remove o ajuste do próximo cálculo/sync, sem modificar posts.
