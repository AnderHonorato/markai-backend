const axios = require('axios');

const SPIDER_API_TOKEN = process.env.SPIDER_API_TOKEN || 'StLPhhtU4RHeD9KVX0aT';
const SPIDER_API_BASE_URL = 'https://api.spiderx.com.br/api/ai/gemini';

async function gerarRespostaIA(mensagemUsuario, contextoDados, historico = []) {
    const { nomeUsuario, profissionaisEncontrados } = contextoDados;

    // Converte os dados reais do banco para a IA processar internamente
    const listaPros = profissionaisEncontrados && profissionaisEncontrados.length > 0
        ? profissionaisEncontrados.map(p => `- ${p.companyName} (ID: ${p.id})`).join('\n')
        : 'Nenhum profissional encontrado.';

    let promptSistema = `Você é a Markaí. O usuário é ${nomeUsuario}.
    
    DADOS REAIS DO BANCO (Use isso para gerar IDs):
    ${listaPros}

    REGRAS DE OURO PARA ACABAR COM O LOOP:
    1. Se o usuário disser "Quero agendar com [NOME]", você deve localizar o ID na lista acima e responder APENAS o JSON de confirmação.
    2. NUNCA pergunte "Seria este?" se o nome for exatamente igual ao que você sugeriu anteriormente.
    3. JSON DE CONFIRMAÇÃO (Se tiver nome, data e hora):
       {"intent": "CONFIRM_BOOKING", "proId": "ID_DA_LISTA", "date": "2026-01-13", "time": "14:00", "message": "Perfeito! Estou confirmando seu agendamento..."}
    4. Se o usuário clicar em um botão de opção, ele enviará o texto "Quero agendar com...". Trate isso como uma decisão final.
    5. Mensagem com no máximo 3 paragrafos. Seja direto e objetivo. Use emojis para tornar a conversa mais leve.
    6. Máxim de 6 profissionais na lista.
    7. Se o agendamento já foi citado como feito no histórico, gere o botão de ver agenda:
       {"intent": "GOTO_APPOINTMENTS", "message": "Seu agendamento está pronto! Clique abaixo."}`;

    let contextoConversa = "";
    historico.forEach(h => { contextoConversa += `${h.fromMe ? 'Agiliza' : 'Usuário'}: ${h.text}\n`; });

    const promptUnificado = `${promptSistema}\n\n${contextoConversa}\nMensagem atual: "${mensagemUsuario}"\nResposta da Agiliza:`;

    try {
        const response = await axios.post(`${SPIDER_API_BASE_URL}?api_key=${SPIDER_API_TOKEN}`, { text: promptUnificado });
        return response.data?.response?.trim();
    } catch (error) {
        return "Erro na IA. Tente novamente.";
    }
}

module.exports = { gerarRespostaIA };