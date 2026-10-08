# Daegon Chat — CRM por departamento

CRM em português com atendimento via WhatsApp Business Cloud API (Meta), contas individuais e permissões por departamento. O site estático anterior foi substituído por uma aplicação com servidor, autenticação e banco persistente. Os arquivos antigos continuam no histórico do Git.

## Funcionalidades

- Interface responsiva para celular, tablet e desktop; estados vazios sem métricas inventadas.
- Login com Better Auth, sessão em cookie HttpOnly, limite de tentativas e alteração de senha.
- Administrador: gestão de departamentos, contas, configuração do bot e visão de toda a operação.
- Atendente: contatos, conversas e relatórios do departamento ao qual está vinculado. As permissões são verificadas no servidor em cada solicitação.
- Cadastro e edição de clientes (nome, WhatsApp, e-mail, empresa e observações).
- Cadastro, edição e desativação de departamentos e usuários; redefinição administrativa de senha.
- Caixa de entrada com pesquisa, filtros, assumir, transferir, resolver, notas internas e histórico.
- Bot com saudação editável e menu numérico gerado a partir dos departamentos ativos.
- Webhook com verificação de token e assinatura HMAC, deduplicação por ID Meta, processamento transacional e fila de saída persistente.
- Mensagens de texto, estados de envio/entrega/leitura, erros visíveis e controle da janela de 24 horas.
- Relatórios por período e departamento, volume, fila, atendimentos resolvidos, tempo de primeira resposta humana e exportação CSV.

## Executar localmente

Requer Node.js **24.15 ou superior**. O banco usa `node:sqlite`, sem serviço externo obrigatório.

1. Execute `npm ci`.
2. Copie `.env.example` para `.env`.
3. Gere `BETTER_AUTH_SECRET` com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` e preencha no `.env`.
4. Defina `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` (12 a 128 caracteres). Não há senha padrão.
5. Execute `npm run setup` uma vez para cadastrar o administrador. Remova `ADMIN_PASSWORD` do ambiente após o cadastro.
6. Execute `npm start` e abra `http://localhost:3000`.

`npm run dev` reinicia o servidor quando o código muda. As tabelas são criadas automaticamente. Os dados ficam em `data/crm.sqlite`; preserve o diretório `data` e faça backups consistentes com SQLite, incluindo seus arquivos WAL durante a operação. Não copie apenas o arquivo principal com o servidor em execução.

A aplicação não reutiliza cadastros fictícios do antigo LocalStorage. O banco começa vazio. O e-mail de uma conta existente permanece fixo; nome, permissão, departamento, status e senha podem ser administrados pela interface.

## Exemplo de operação

1. Entre como administrador e cadastre **Financeiro**, **Comercial** e **Suporte**.
2. Em **Equipe**, crie **João Silva**, selecione **Atendente** e vincule ao **Financeiro**.
3. Ative o menu em **Bot de atendimento** e configure a integração em seu servidor.
4. Ao receber uma mensagem, o bot responde com as opções numeradas. Escolher Financeiro coloca a conversa na fila desse setor.
5. João entra com sua própria conta, assume a conversa e responde. Comercial não acessa esse atendimento.
6. A transferência troca a fila, remove o responsável anterior e altera o departamento do contato. O histórico acompanha a conversa.
7. Ao resolver, o histórico permanece disponível. Uma nova mensagem inicia outro atendimento e uma nova triagem.

O menu de cada conversa preserva os IDs das opções apresentadas. Renomear ou cadastrar um setor não muda o significado de uma escolha já oferecida. Se o setor escolhido tiver sido desativado, o bot apresenta um menu atualizado. Sem departamentos ativos ou com bot desativado, a conversa fica em **Triagem**, visível ao administrador. Assumir uma conversa de triagem pausa o bot nela.

## Configurar a API oficial do WhatsApp

No servidor, configure:

| Variável                   | Uso                                                                             |
| -------------------------- | ------------------------------------------------------------------------------- |
| `APP_URL`                  | Origem pública exata, sem barra final, por exemplo `https://crm.suaempresa.com` |
| `WHATSAPP_ACCESS_TOKEN`    | Token da Meta com permissão de mensagens e acesso ao número                     |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número habilitado no WhatsApp Business                                    |
| `WHATSAPP_VERIFY_TOKEN`    | Valor secreto escolhido por você para verificar o webhook                       |
| `META_APP_SECRET`          | Segredo do aplicativo Meta para validar assinaturas                             |
| `META_GRAPH_VERSION`       | Versão habilitada no aplicativo, por exemplo `v25.0`                            |

Cadastre `https://crm.suaempresa.com/api/whatsapp/webhook` como callback do aplicativo Meta, valide com o mesmo `WHATSAPP_VERIFY_TOKEN` e assine o campo **messages** da conta WhatsApp Business. Reinicie o servidor após alterar variáveis. A tela **WhatsApp API** informa variáveis ausentes; “Configurada” significa que elas estão presentes, não que um token já foi validado com a Meta.

Referências oficiais: [API de mensagens da Meta](https://www.postman.com/meta/whatsapp-business-platform/overview), [Webhooks da Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks).

O worker tenta enviar a cada dois segundos. Respostas explícitas de rate limit ou erro 5xx permitem até cinco tentativas com intervalo crescente. Falhas de rede sem confirmação não são reenviadas automaticamente, pois a Meta pode já ter aceitado a mensagem. IDs recebidos são deduplicados. Esta integração não promete entrega exatamente uma vez em caso de queda entre aceitação remota e gravação local.

## Hospedagem

Esta versão requer **um processo Node com disco persistente**, além de HTTPS público para a Meta. Não funciona como site estático no GitHub Pages ou em um runtime com sistema de arquivos descartável. Use uma VPS ou serviço de containers com volume persistente e uma única instância da aplicação.

Há um `Dockerfile` para hospedagem em container:

```sh
docker build -t daegonchat .
docker volume create daegon-data
docker run --rm --env-file .env -v daegon-data:/app/data daegonchat npm run setup
docker run -d --name daegonchat --restart unless-stopped --env-file .env -e HOST=0.0.0.0 -p 127.0.0.1:3000:3000 -v daegon-data:/app/data daegonchat
```

Configure `APP_URL` com a origem HTTPS do proxy. Quando um proxy confiável está no mesmo host, `TRUST_PROXY=loopback` permite obter o IP de origem para o limite de login. Não exponha o backend sem restrição de rede atrás de um proxy configurado como confiável. Cookies seguros são ativados pelo Better Auth em HTTPS. O servidor sobrescreve o cabeçalho interno usado no limite de tentativas para impedir falsificação pelo cliente.

A implantação, o domínio, a conta Meta e o envio com credenciais reais precisam ser configurados e validados no ambiente escolhido. O Dockerfile não foi executado neste ambiente Windows.

## Validação

- `npm test`: integração HTTP com banco isolado, login, cadastros, controle de acesso entre setores, webhook assinado, deduplicação, bot, envio com transporte simulado, transferências, relatórios, revogação e proteção de arquivos privados.
- `npm run test:browser`: testes de fluxo em navegador Chrome instalado, com banco isolado e contas temporárias, capturas em `artifacts/` e inspeção de overflow em 390, 768 e 1440 pixels. Nenhuma mensagem real é enviada.
- `npm run format:check`: formatação.

## Limites desta versão

Mensagens de texto são suportadas. Áudios, imagens e documentos recebidos aparecem como avisos de mídia; o download e envio de anexos não estão implementados. Templates aprovados para iniciar conversas fora da janela de 24 horas, recuperação de senha por e-mail e múltiplas empresas independentes não estão incluídos. O administrador pode redefinir senhas. Os relatórios usam a data de abertura, o departamento atual da conversa e horário de Brasília para os filtros. O histórico fica disponível à equipe que recebe uma transferência. Atualizações da caixa de entrada são consultadas a cada cinco segundos.
