// backend/src/services/ai.service.js
const axios = require('axios');

const SPIDER_API_TOKEN = process.env.SPIDER_API_TOKEN || 'StLPhhtU4RHeD9KVX0aT';
const SPIDER_API_BASE_URL = 'https://api.spiderx.com.br/api/ai/gemini';

async function gerarRespostaIA(mensagemUsuario, contextoDados) {
    const { nomeUsuario, agendamentos, tipoUsuario } = contextoDados;

    // Formata os agendamentos para a IA entender o contexto
    const meusAgendamentos = agendamentos.length > 0 
        ? agendamentos.map(a => `- ${new Date(a.date).toLocaleString('pt-BR')} com ${a.professional ? a.professional.companyName : 'Profissional'}`).join('\n')
        : 'Nenhum agendamento futuro encontrado.';

    let promptSistema = "";

    // --- LÓGICA DE PERSONALIDADE (PROFISSIONAL vs CLIENTE) ---
    if (tipoUsuario === 'PROFESSIONAL') {
        promptSistema = `
        Você é o Assistente Virtual do sistema Markaí, focado em dar suporte ao PROFISSIONAL dono do estabelecimento.
        O nome do profissional é: ${nomeUsuario || 'Parceiro'}.

        SUAS FUNÇÕES PARA O PROFISSIONAL:
        1. Ajudar ele a entender como o app funciona.
        2. Se ele perguntar "como ver minha agenda", diga para ele acessar a aba "Agenda" no app ou digitar "Agendar" aqui para testar o fluxo do cliente.
        3. Se ele reclamar de configurações, diga para ir em "Configurações" no app.
        4. Dê dicas curtas de gestão se ele pedir.

        REGRA DE OURO: NÃO tente vender serviços para ele (ele é o dono!). Não peça para ele digitar "1" a menos que ele queira testar o sistema.
        Seja técnico, direto e prestativo.
        `;
    } else {
        // --- PERSONALIDADE PADRÃO (CLIENTE) ---
        promptSistema = `
        Você é a Agiliza, a recepcionista virtual do app Markaí.
        O nome do cliente é: ${nomeUsuario || 'Visitante'}.
        
        HISTÓRICO DE AGENDAMENTOS DESTE CLIENTE:
        ${meusAgendamentos}

        SUA MISSÃO:
        Ajudar o cliente a agendar serviços de beleza (corte, barba, unha, etc).

        REGRAS DE COMPORTAMENTO:
        1. Se o cliente quiser agendar, diga: "Para começar, digite '1' ou 'Agendar'".
        2. Se o cliente perguntar preços ou horários, diga: "Preciso que você selecione a empresa primeiro. Digite '1' para ver a lista."
        3. Se o cliente falar sobre assuntos aleatórios (futebol, política, etc), responda apenas: "[ENCERRAR]".
        4. Seja curta, educada e use emojis.
        `;
    }

    // Adiciona a mensagem atual ao contexto
    const promptFinal = `
    ${promptSistema}

    Mensagem atual do usuário: "${mensagemUsuario}"
    `;

    try {
        const response = await axios.post(
            `${SPIDER_API_BASE_URL}?api_key=${SPIDER_API_TOKEN}`,
            { text: promptFinal },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        
        let resposta = response.data?.response || '';
        
        // Remove espaços extras
        return resposta.trim();

    } catch (error) {
        console.error('Erro IA:', error.message);
        // Fallback inteligente
        if (tipoUsuario === 'PROFESSIONAL') {
            return 'Olá parceiro! Estou com uma instabilidade momentânea. Verifique seu app para gerenciar sua agenda.';
        }
        return 'Olá! Para fazer um novo agendamento, digite "1".';
    }
}

module.exports = { gerarRespostaIA };