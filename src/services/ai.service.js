// backend/src/services/ai.service.js
const axios = require('axios');

const SPIDER_API_TOKEN = process.env.SPIDER_API_TOKEN || 'StLPhhtU4RHeD9KVX0aT';
const SPIDER_API_BASE_URL = 'https://api.spiderx.com.br/api/ai/gemini';

async function gerarRespostaIA(mensagemUsuario, contextoDados) {
    const { nomeUsuario, agendamentos } = contextoDados;

    const meusAgendamentos = agendamentos.length > 0 
        ? agendamentos.map(a => `- ${new Date(a.date).toLocaleString('pt-BR')} em ${a.professional.companyName}`).join('\n')
        : 'Você não tem agendamentos futuros.';

    const promptSistema = `
    Você é a assistente virtual do app Markaí. Seu nome é Agiliza.
    
    DADOS DO CLIENTE:
    Nome: ${nomeUsuario || 'Visitante'}
    Agendamentos: 
    ${meusAgendamentos}

    SUA MISSÃO:
    Agendar serviços (corte, barba, unha, estética, etc).

    REGRAS DE COMPORTAMENTO (RÍGIDAS):
    1. Se o cliente falar sobre política, futebol, religião, receitas, código, ou qualquer coisa que NÃO SEJA agendamento ou o app:
       - Responda EXATAMENTE: "[ENCERRAR]" (sem aspas, apenas a tag).
    2. Se o cliente insistir em papo furado: Responda "[ENCERRAR]".
    3. Se for sobre agendamento:
       - Se ele perguntar empresas: "Temos ótimas opções! Digite '1' ou 'Agendar' para ver."
       - Se ele quiser marcar: "Claro! Digite '1' para começarmos."
       - Se perguntar horários: "Preciso saber a empresa primeiro. Digite '1' para iniciar."
    4. Seja curta e direta.

    Mensagem do cliente: "${mensagemUsuario}"
    `;

    try {
        const response = await axios.post(
            `${SPIDER_API_BASE_URL}?api_key=${SPIDER_API_TOKEN}`,
            { text: promptSistema },
            { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        
        const resposta = response.data?.response || '';
        // Limpeza de segurança caso a IA mande espaços extras
        return resposta.trim();

    } catch (error) {
        console.error('Erro IA:', error.message);
        return 'Olá! Para fazer um agendamento, digite "1".';
    }
}

module.exports = { gerarRespostaIA };