// backend/src/services/ai.service.js
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SPIDER_API_TOKEN = process.env.SPIDER_API_TOKEN || 'StLPhhtU4RHeD9KVX0aT';
const SPIDER_API_BASE_URL = 'https://api.spiderx.com.br/api/ai/gemini';

const conversationStates = {};
const socketsByProfessional = {};

// ✅ SISTEMA DE DEBOUNCE PARA EVITAR SPAM
const messageQueue = {}; // Armazena mensagens pendentes
const responseTimers = {}; // Timers de espera
const typingIntervals = {}; // Intervalos de "digitando..."

const DEBOUNCE_TIME = 15000; // 15 segundos de espera
const TYPING_INTERVAL = 5000; // Envia "digitando..." a cada 5 segundos

function registrarSocket(professionalId, sock) {
    socketsByProfessional[professionalId] = sock;
    console.log(`[IA] Socket registrado para profissional: ${professionalId}`);
}

// ✅ NOVA FUNÇÃO: Adiciona mensagem à fila e agenda resposta
async function processarMensagemComDebounce(mensagemUsuario, dadosProfissional, historico, phoneNumber, enviarResposta, enviarDigitando) {
    const clienteId = phoneNumber || 'unknown';
    
    // ✅ VERIFICA SE ESTÁ BLOQUEADO (ENCERRADO)
    const estado = conversationStates[clienteId];
    if (estado && estado.etapa === 'BLOQUEADO') {
        console.log(`[DEBOUNCE] 🚫 Cliente bloqueado - ignorando mensagem`);
        return; // ✅ IGNORA COMPLETAMENTE A MENSAGEM
    }
    
    // Inicializa fila se não existir
    if (!messageQueue[clienteId]) {
        messageQueue[clienteId] = [];
    }
    
    // Adiciona mensagem à fila
    messageQueue[clienteId].push(mensagemUsuario);
    console.log(`[DEBOUNCE] 📥 Mensagem adicionada à fila (${clienteId}): "${mensagemUsuario}"`);
    
    // Cancela timer anterior se existir
    if (responseTimers[clienteId]) {
        clearTimeout(responseTimers[clienteId]);
        console.log(`[DEBOUNCE] ⏸️ Timer cancelado - aguardando mais mensagens`);
    }
    
    // Cancela intervalo de "digitando..." anterior
    if (typingIntervals[clienteId]) {
        clearInterval(typingIntervals[clienteId]);
        delete typingIntervals[clienteId];
    }
    
    // ✅ ENVIA "DIGITANDO..." IMEDIATAMENTE
    if (enviarDigitando) {
        enviarDigitando();
        console.log(`[DEBOUNCE] ⌨️ Status "digitando..." enviado`);
    }
    
    // ✅ CRIA INTERVALO PARA ENVIAR "DIGITANDO..." A CADA 5 SEGUNDOS
    typingIntervals[clienteId] = setInterval(() => {
        if (enviarDigitando) {
            enviarDigitando();
            console.log(`[DEBOUNCE] ⌨️ Status "digitando..." reenviado`);
        }
    }, TYPING_INTERVAL);
    
    // Cria novo timer
    responseTimers[clienteId] = setTimeout(async () => {
        console.log(`[DEBOUNCE] ⏰ Timer finalizado - processando mensagens`);
        
        // ✅ PARA O INTERVALO DE "DIGITANDO..."
        if (typingIntervals[clienteId]) {
            clearInterval(typingIntervals[clienteId]);
            delete typingIntervals[clienteId];
        }
        
        // Pega todas as mensagens da fila
        const mensagensAgrupadas = [...messageQueue[clienteId]];
        messageQueue[clienteId] = []; // Limpa a fila
        
        console.log(`[DEBOUNCE] 📨 Processando ${mensagensAgrupadas.length} mensagem(ns)`);
        
        // Junta todas as mensagens em uma só
        const mensagemCompleta = mensagensAgrupadas.join(' ');
        
        try {
            // Processa a mensagem completa
            const resposta = await gerarRespostaProfissional(
                mensagemCompleta,
                dadosProfissional,
                historico,
                phoneNumber
            );
            
            // Envia resposta
            if (resposta) {
                enviarResposta(resposta);
                console.log(`[DEBOUNCE] ✅ Resposta enviada`);
            }
            
        } catch (error) {
            console.error('[DEBOUNCE] ❌ Erro ao processar:', error);
            enviarResposta('❌ Ops! Tive um problema. Pode tentar novamente?');
        }
        
        // Limpa o timer
        delete responseTimers[clienteId];
        
    }, DEBOUNCE_TIME);
    
    console.log(`[DEBOUNCE] ⏳ Timer iniciado - aguardando ${DEBOUNCE_TIME/1000}s`);
}

async function gerarRespostaProfissional(mensagemUsuario, dadosProfissional, historico = [], phoneNumber = null) {
    const { profissionalNome, servicos, agendaOcupada, horarioTrabalho, professionalId } = dadosProfissional;
    
    const clienteId = phoneNumber || 'unknown';
    const msgLower = mensagemUsuario.toLowerCase().trim();
    
    // ✅ DETECTA INTENÇÃO DE AGENDAR
    const palavrasAgendamento = ['agendar', 'marcar', 'horário', 'horario', 'marcar hora', 'quero marcar'];
    const querAgendar = palavrasAgendamento.some(palavra => msgLower.includes(palavra));
    
    // ✅ SE ESTIVER BLOQUEADO E QUER AGENDAR, DESBLOQUEIA
    if (conversationStates[clienteId] && conversationStates[clienteId].etapa === 'BLOQUEADO') {
        if (querAgendar) {
            console.log(`[IA] 🔓 Desbloqueando cliente - quer agendar`);
            conversationStates[clienteId] = {
                etapa: 'ESCOLHENDO_SERVICO',
                modoAgendamento: true,
                servicoEscolhido: null,
                diaEscolhido: null,
                horaEscolhida: null,
                nomeCliente: null,
                cpfCliente: null,
                emailCliente: null,
                telefoneCliente: phoneNumber,
                appointmentId: null,
                confirmandoMultiplo: false
            };
            return montarMensagemServicos(servicos, profissionalNome);
        } else {
            // ✅ ESTÁ BLOQUEADO E NÃO QUER AGENDAR - NÃO RESPONDE
            console.log(`[IA] 🚫 Cliente bloqueado tentando conversar - ignorando`);
            return null; // ✅ RETORNA NULL PARA NÃO ENVIAR NADA
        }
    }
    
    if (querAgendar && (!conversationStates[clienteId] || conversationStates[clienteId].etapa === 'CONVERSANDO_IA' || conversationStates[clienteId].etapa === 'ENCERRADO')) {
        conversationStates[clienteId] = {
            etapa: 'ESCOLHENDO_SERVICO',
            modoAgendamento: true,
            servicoEscolhido: null,
            diaEscolhido: null,
            horaEscolhida: null,
            nomeCliente: null,
            cpfCliente: null,
            emailCliente: null,
            telefoneCliente: phoneNumber,
            appointmentId: null,
            confirmandoMultiplo: false
        };
        
        console.log(`[IA] 🎯 Cliente quer agendar! Telefone inicial: ${phoneNumber}`);
        return montarMensagemServicos(servicos, profissionalNome);
    }
    
    // Inicializa estado
    if (!conversationStates[clienteId]) {
        conversationStates[clienteId] = {
            etapa: 'CONVERSANDO_IA',
            modoAgendamento: false,
            servicoEscolhido: null,
            diaEscolhido: null,
            horaEscolhida: null,
            nomeCliente: null,
            cpfCliente: null,
            emailCliente: null,
            telefoneCliente: phoneNumber,
            appointmentId: null,
            confirmandoMultiplo: false,
            mensagensIA: 0,
            ultimaInteracao: Date.now()
        };
    }
    
    const estado = conversationStates[clienteId];
    
    // ============================================
    // MODO CONVERSAÇÃO COM IA
    // ============================================
    if (estado.etapa === 'CONVERSANDO_IA') {
        if (msgLower.includes('sair') || msgLower.includes('tchau') || msgLower.includes('encerrar')) {
            delete conversationStates[clienteId];
            return `Até logo! 👋\nQualquer coisa, é só chamar!`;
        }
        
        // ✅ ATUALIZA ÚLTIMA INTERAÇÃO
        estado.ultimaInteracao = Date.now();
        
        // ✅ INCREMENTA CONTADOR DE MENSAGENS
        estado.mensagensIA = (estado.mensagensIA || 0) + 1;
        
        // ✅ SE PASSOU DE 5 MENSAGENS SEM AGENDAR, ENCERRA E BLOQUEIA
        if (estado.mensagensIA >= 5) {
            estado.etapa = 'BLOQUEADO'; // ✅ BLOQUEIA COMPLETAMENTE
            console.log(`[IA] 🚫 Cliente bloqueado após ${estado.mensagensIA} mensagens sem agendar`);
            return `🤖 Percebi que você está conversando sem intenção de agendar.\n\n😊 Sou uma IA focada em agendamentos, não consigo bater papo.\n\n✨ Se mudar de ideia e quiser *agendar*, é só me chamar!\n\nAté mais! 👋`;
        }
        
        return await conversarComIA(mensagemUsuario, profissionalNome, servicos, historico);
    }
    
    if (estado.etapa === 'ENCERRADO') {
        if (querAgendar) {
            estado.etapa = 'ESCOLHENDO_SERVICO';
            estado.modoAgendamento = true;
            estado.mensagensIA = 0;
            estado.respostasEncerrado = 0;
            return montarMensagemServicos(servicos, profissionalNome);
        }

        estado.respostasEncerrado = (estado.respostasEncerrado || 0) + 1;

        const mensagensVariadas = [
            `💡 Para agendar, digite *"agendar"*`,
            `😊 Quando quiser marcar, é só digitar *"agendar"*`,
            `✨ Estou aqui quando precisar! Digite *"agendar"*`,
            `📅 Pronto para agendar? Digite *"agendar"*`
        ];

        const index = estado.respostasEncerrado % mensagensVariadas.length;
        return mensagensVariadas[index];
    }
    
    // ============================================
    // FLUXO DE AGENDAMENTO
    // ============================================
    
    // ETAPA 1: ESCOLHENDO SERVIÇO
    if (estado.etapa === 'ESCOLHENDO_SERVICO') {
        const escolha = parseInt(mensagemUsuario);
        
        if (isNaN(escolha) || escolha < 1 || escolha > servicos.length) {
            return `❌ *Ops! Número inválido*\n\n😊 Por favor, escolha um número entre *1 e ${servicos.length}*`;
        }
        
        estado.servicoEscolhido = servicos[escolha - 1];
        estado.etapa = 'ESCOLHENDO_DIA';
        
        return `✅ *Perfeito!* Você escolheu:\n\n💎 *${estado.servicoEscolhido.name}*\n💰 R$ ${parseFloat(estado.servicoEscolhido.price).toFixed(2)}\n\n📆 *Agora me diga, qual dia funciona melhor para você?*\n\n_Você pode digitar:_\n• *Hoje*\n• *Amanhã*\n• Ou uma data específica como *20/01/2026*`;
    }
    
    // ETAPA 2: ESCOLHENDO DIA
    if (estado.etapa === 'ESCOLHENDO_DIA') {
        const dataEscolhida = parseDataMensagem(mensagemUsuario);
        
        if (!dataEscolhida) {
            return `❌ *Hmm, não consegui entender essa data*\n\n😊 Tente usar um desses formatos:\n• *DD/MM/AAAA* (exemplo: 20/01/2026)\n• *"hoje"*\n• *"amanhã"*`;
        }
        
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        
        const dataEscolhidaLimpa = new Date(dataEscolhida);
        dataEscolhidaLimpa.setHours(0, 0, 0, 0);
        
        if (dataEscolhidaLimpa < hoje) {
            return `❌ *Ops! Essa data já passou*\n\n😊 Escolha hoje ou uma data futura, por favor`;
        }
        
        const agendamentoExistente = await verificarAgendamentoExistente(phoneNumber, dataEscolhida, professionalId);
        
        if (agendamentoExistente) {
            const horaAgendamento = new Date(agendamentoExistente.date).toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            estado.diaEscolhido = dataEscolhida;
            estado.etapa = 'CONFIRMANDO_MULTIPLO';
            
            return `⚠️ *Opa! Encontrei algo importante*\n\nVocê já tem um agendamento marcado para *${formatarData(dataEscolhida)}* às *${horaAgendamento}* com a gente! 📅\n\n🤔 *Deseja agendar outro horário no mesmo dia?*\n\n• Digite *"sim"* para continuar\n• Digite *"não"* para escolher outra data`;
        }
        
        estado.diaEscolhido = dataEscolhida;
        estado.etapa = 'ESCOLHENDO_HORA';
        
        const horariosDisponiveis = await buscarHorariosDisponiveis(
            dataEscolhida, 
            agendaOcupada, 
            {
                start: horarioTrabalho.start || '08:00',
                end: horarioTrabalho.end || '18:00',
                duration: dadosProfissional.duracaoServico || 60
            },
            professionalId
        );
        
        if (horariosDisponiveis.length === 0) {
            estado.etapa = 'ESCOLHENDO_DIA';
            const isHoje = new Date(dataEscolhida).toDateString() === new Date().toDateString();
            
            if (isHoje) {
                return `😔 *Puxa, que pena!*\n\nTodos os horários de hoje já estão ocupados ou já passaram.\n\n💡 Que tal tentar *"amanhã"* ou escolher outra data?`;
            } else {
                return `😔 *Nossa agenda está lotada nesse dia!*\n\nA data *${formatarData(dataEscolhida)}* está completamente preenchida.\n\n💡 Pode escolher outro dia? Tenho certeza que encontraremos um horário perfeito! 😊`;
            }
        }
        
        const HORARIOS_POR_PAGINA = 12;
        const primeirosHorarios = horariosDisponiveis.slice(0, HORARIOS_POR_PAGINA);
        const temMais = horariosDisponiveis.length > HORARIOS_POR_PAGINA;
        
        estado.todosHorarios = horariosDisponiveis;
        estado.paginaAtual = 1;
        
        let listaHorarios = `📅 *Ótimo!* Você escolheu *${formatarData(dataEscolhida)}*\n\n🕐 *Aqui estão os horários disponíveis:*\n\n`;
        primeirosHorarios.forEach((hora, i) => {
            listaHorarios += `*${i + 1}.* ${hora}\n`;
        });
        
        if (temMais) {
            listaHorarios += `\n💡 _Digite o número do horário que preferir_\n_Ou digite "mais" para ver outras opções_\n\n📊 Mostrando ${HORARIOS_POR_PAGINA} de ${horariosDisponiveis.length} horários disponíveis`;
        } else {
            listaHorarios += `\n💡 _Digite o número do horário que funciona melhor para você_`;
        }
        
        return listaHorarios;
    }
    
    // ETAPA 3: CONFIRMANDO MÚLTIPLO
    if (estado.etapa === 'CONFIRMANDO_MULTIPLO') {
        const resposta = msgLower;
        
        if (resposta === 'sim' || resposta === 's') {
            estado.etapa = 'ESCOLHENDO_HORA';
            
            const horariosDisponiveis = await buscarHorariosDisponiveis(
                estado.diaEscolhido, 
                agendaOcupada, 
                {
                    start: horarioTrabalho.start || '08:00',
                    end: horarioTrabalho.end || '18:00',
                    duration: dadosProfissional.duracaoServico || 60
                },
                professionalId
            );
            
            if (horariosDisponiveis.length === 0) {
                estado.etapa = 'ESCOLHENDO_DIA';
                return `😔 *Ops! Não encontrei horários disponíveis*\n\n💡 Que tal escolher outra data?`;
            }
            
            const HORARIOS_POR_PAGINA = 12;
            const primeirosHorarios = horariosDisponiveis.slice(0, HORARIOS_POR_PAGINA);
            const temMais = horariosDisponiveis.length > HORARIOS_POR_PAGINA;
            
            estado.todosHorarios = horariosDisponiveis;
            estado.paginaAtual = 1;
            
            let listaHorarios = `📅 *${formatarData(estado.diaEscolhido)}*\n\n🕐 *Horários disponíveis para você:*\n\n`;
            primeirosHorarios.forEach((hora, i) => {
                listaHorarios += `*${i + 1}.* ${hora}\n`;
            });
            
            if (temMais) {
                listaHorarios += `\n💡 _Digite o número ou "mais" para ver outras opções_\n\n📊 Mostrando ${HORARIOS_POR_PAGINA} de ${horariosDisponiveis.length} horários`;
            } else {
                listaHorarios += `\n💡 _Digite o número do horário escolhido_`;
            }
            
            return listaHorarios;
            
        } else if (resposta === 'não' || resposta === 'nao' || resposta === 'n') {
            delete conversationStates[clienteId];
            return `❌ *Agendamento cancelado*\n\n😊 Sem problemas! Se mudar de ideia, é só digitar *"agendar"* que te ajudo novamente!`;
        } else {
            return `🤔 *Preciso que você escolha uma opção*\n\nPor favor, responda *"sim"* ou *"não"*`;
        }
    }
    
    // ETAPA 4: ESCOLHENDO HORA
    if (estado.etapa === 'ESCOLHENDO_HORA') {
        const msgLower = mensagemUsuario.toLowerCase().trim();
        
        if (msgLower === 'mais') {
            const HORARIOS_POR_PAGINA = 12;
            const todosHorarios = estado.todosHorarios || [];
            const paginaAtual = estado.paginaAtual || 1;
            const proximaPagina = paginaAtual + 1;
            
            const inicio = (proximaPagina - 1) * HORARIOS_POR_PAGINA;
            const fim = inicio + HORARIOS_POR_PAGINA;
            const horariosExibir = todosHorarios.slice(inicio, fim);
            
            if (horariosExibir.length === 0) {
                return `📋 *Fim da lista!*\n\nEsses são todos os horários disponíveis que temos.\n\n💡 Digite o número do horário que você prefere! 😊`;
            }
            
            estado.paginaAtual = proximaPagina;
            
            let listaHorarios = `📅 *${formatarData(estado.diaEscolhido)}*\n\n🕐 *Mais horários para você:*\n\n`;
            horariosExibir.forEach((hora, i) => {
                const numeroGlobal = inicio + i + 1;
                listaHorarios += `*${numeroGlobal}.* ${hora}\n`;
            });
            
            const temMais = fim < todosHorarios.length;
            if (temMais) {
                listaHorarios += `\n💡 _Digite o número ou "mais" para continuar_\n\n📊 Mostrando até ${Math.min(fim, todosHorarios.length)} de ${todosHorarios.length}`;
            } else {
                listaHorarios += `\n💡 _Digite o número do horário escolhido_`;
            }
            
            return listaHorarios;
        }
        
        const todosHorarios = estado.todosHorarios || await buscarHorariosDisponiveis(
            estado.diaEscolhido, 
            agendaOcupada, 
            {
                start: horarioTrabalho.start || '08:00',
                end: horarioTrabalho.end || '18:00',
                duration: dadosProfissional.duracaoServico || 60
            },
            professionalId
        );
        
        const escolha = parseInt(mensagemUsuario);
        if (isNaN(escolha) || escolha < 1 || escolha > todosHorarios.length) {
            return `❌ *Ops! Número inválido*\n\n😊 Por favor, escolha um número entre *1 e ${todosHorarios.length}*\n_Ou digite "mais" para ver outras opções_`;
        }
        
        estado.horaEscolhida = todosHorarios[escolha - 1];
        estado.etapa = 'COLETANDO_EMAIL';
        
        return `✅ *Perfeito! Horário confirmado:* ${estado.horaEscolhida}\n\n📧 *Agora preciso verificar se você já é nosso cliente*\n\nPor favor, me informe seu e-mail:`;
    }
    
    // ETAPA 5: COLETANDO EMAIL
    if (estado.etapa === 'COLETANDO_EMAIL') {
        const email = mensagemUsuario.trim().toLowerCase();
        
        if (!email.includes('@') || !email.includes('.')) {
            return `❌ *Hmm, esse e-mail não parece válido*\n\n😊 Por favor, digite um e-mail válido\n_Exemplo: seuemail@gmail.com_`;
        }
        
        try {
            const clienteExistente = await prisma.user.findFirst({
                where: { email: email }
            });
            
            if (clienteExistente) {
                console.log(`[IA] ✅ Cliente já cadastrado: ${clienteExistente.name}`);
                
                estado.emailCliente = email;
                estado.nomeCliente = clienteExistente.name;
                estado.cpfCliente = clienteExistente.cpf;
                estado.telefoneCliente = clienteExistente.phone;
                estado.clienteId = clienteExistente.id;
                estado.etapa = 'CONFIRMANDO_AGENDAMENTO';
                
                return `🎉 *Que bom te ver de novo, ${clienteExistente.name}!*\n\n📋 *Vamos confirmar os detalhes do seu agendamento:*\n\n💎 *Serviço:* ${estado.servicoEscolhido.name}\n💰 *Valor:* R$ ${parseFloat(estado.servicoEscolhido.price).toFixed(2)}\n📅 *Data:* ${formatarData(estado.diaEscolhido)}\n🕐 *Horário:* ${estado.horaEscolhida}\n👤 *Cliente:* ${clienteExistente.name}\n📧 *E-mail:* ${email}\n\n*Está tudo certo?*\n\n• Digite *"sim"* para confirmar\n• Digite *"não"* se quiser mudar algo`;
            }
            
            estado.emailCliente = email;
            estado.etapa = 'COLETANDO_NOME';
            
            return `📝 *E-mail registrado:* ${email}\n\n😊 *Parece que é sua primeira vez aqui! Que legal!*\n\nVamos fazer um cadastro rápido para finalizar.\n\n👤 *Qual é seu nome completo?*`;
            
        } catch (error) {
            console.error('[IA] Erro ao verificar e-mail:', error);
            return `❌ *Ops! Tive um problema técnico*\n\n😅 Pode tentar novamente, por favor?`;
        } 
    }
    
    // ETAPA: CONFIRMANDO AGENDAMENTO (CLIENTE EXISTENTE)
    if (estado.etapa === 'CONFIRMANDO_AGENDAMENTO') {
        const resposta = msgLower;
        
        if (resposta === 'sim' || resposta === 's') {
            try {
                const clienteExistente = await prisma.user.findUnique({
                    where: { id: estado.clienteId }
                });
                
                const resultado = await finalizarAgendamento(estado, clienteExistente.phone, professionalId, clienteExistente);
                delete conversationStates[clienteId];
                return resultado;
            } catch (error) {
                console.error('[IA] Erro ao finalizar:', error);
                delete conversationStates[clienteId];
                return `❌ *Ops! Algo deu errado*\n\n😅 Pode tentar agendar novamente? Digite *"agendar"*`;
            }
        } else if (resposta === 'não' || resposta === 'nao' || resposta === 'n') {
            delete conversationStates[clienteId];
            return `❌ *Agendamento cancelado*\n\n😊 Sem problemas! Quando quiser marcar, é só digitar *"agendar"*`;
        } else {
            return `🤔 *Preciso de uma resposta clara*\n\nPor favor, digite *"sim"* ou *"não"*`;
        }
    }
    
    // ETAPA 6: COLETANDO NOME
    if (estado.etapa === 'COLETANDO_NOME') {
        const nome = mensagemUsuario.trim();
        
        if (nome.length < 3) {
            return `❌ *Nome muito curto*\n\n😊 Por favor, informe seu nome completo`;
        }
        
        if (nome.includes('@') || nome.includes('.com')) {
            return `❌ *Ops! Isso parece ser um e-mail*\n\n😊 Preciso do seu *nome completo*, por favor`;
        }
        
        estado.nomeCliente = nome;
        estado.etapa = 'COLETANDO_CPF';
        
        return `✅ *Prazer em conhecer você, ${nome}!* 😊\n\n🆔 *Agora preciso do seu CPF (somente números):*`;
    }
    
    // ETAPA 7: COLETANDO CPF
    if (estado.etapa === 'COLETANDO_CPF') {
        const cpfLimpo = mensagemUsuario.replace(/\D/g, '');
        
        if (cpfLimpo.length !== 11) {
            return `❌ *CPF inválido*\n\n😊 O CPF precisa ter exatamente 11 dígitos\n_Pode digitar com ou sem pontos e traço_`;
        }
        
        estado.cpfCliente = cpfLimpo;
        estado.etapa = 'COLETANDO_TELEFONE';
        
        return `✅ *CPF registrado:* ${formatarCPF(cpfLimpo)}\n\n📱 *Último passo! Qual é seu telefone com DDD?*\n\n_Exemplo: 11987654321_`;
    }
    
    // ETAPA 8: COLETANDO TELEFONE
    if (estado.etapa === 'COLETANDO_TELEFONE') {
        const telefoneLimpo = mensagemUsuario.replace(/\D/g, '');
        
        if (telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
            return `❌ *Telefone inválido*\n\n😊 Digite com DDD (10 ou 11 dígitos)\n_Exemplo: 11987654321_`;
        }
        
        let telefoneFormatado = telefoneLimpo;
        if (!telefoneFormatado.startsWith('55')) {
            telefoneFormatado = '55' + telefoneFormatado;
        }
        
        estado.telefoneCliente = telefoneFormatado;
        estado.etapa = 'CONFIRMANDO_CADASTRO_NOVO';
        
        return `📋 *Perfeito! Vamos revisar tudo antes de confirmar:*\n\n*📅 Detalhes do Agendamento:*\n💎 *Serviço:* ${estado.servicoEscolhido.name}\n💰 *Valor:* R$ ${parseFloat(estado.servicoEscolhido.price).toFixed(2)}\n📅 *Data:* ${formatarData(estado.diaEscolhido)}\n🕐 *Horário:* ${estado.horaEscolhida}\n\n*👤 Seus Dados:*\n• *Nome:* ${estado.nomeCliente}\n• *CPF:* ${formatarCPF(estado.cpfCliente)}\n• *E-mail:* ${estado.emailCliente}\n• *Telefone:* ${formatarTelefone(telefoneFormatado)}\n\n*Está tudo certo?*\n\n• Digite *"sim"* para confirmar\n• Digite *"não"* se precisar corrigir algo`;
    }
    
    // ETAPA: CONFIRMANDO CADASTRO NOVO
    if (estado.etapa === 'CONFIRMANDO_CADASTRO_NOVO') {
        const resposta = msgLower;
        
        if (resposta === 'sim' || resposta === 's') {
            try {
                const resultado = await finalizarAgendamento(estado, estado.telefoneCliente, professionalId, null);
                delete conversationStates[clienteId];
                return resultado;
            } catch (error) {
                console.error('[IA] Erro ao finalizar:', error);
                delete conversationStates[clienteId];
                return `❌ *Ops! Algo deu errado*\n\n😅 Pode tentar agendar novamente? Digite *"agendar"*`;
            }
        } else if (resposta === 'não' || resposta === 'nao' || resposta === 'n') {
            delete conversationStates[clienteId];
            return `❌ *Agendamento cancelado*\n\n😊 Sem problemas! Quando quiser marcar, é só digitar *"agendar"*`;
        } else {
            return `🤔 *Preciso de uma resposta clara*\n\nPor favor, digite *"sim"* ou *"não"*`;
        }
    }
    
    return `🤔 *Não entendi muito bem*\n\n💡 Digite *"agendar"* para começar ou *"sair"* para encerrar`;
}

async function conversarComIA(mensagem, profissionalNome, servicos, historico) {
    try {
        let listaServicos = '';
        if (servicos && servicos.length > 0) {
            listaServicos = servicos.map(s => `• ${s.name} (R$ ${s.price})`).join('\n');
        }
        
        const promptSistema = `Você é Markaí, assistente virtual carismática e objetiva de ${profissionalNome}.

PERSONALIDADE:
- Seja simpática, mas descontraida, profissional e objetiva
- Respostas curtas e diretas (máximo 300 caracteres)
- Máximo 3 parágrafos curtos por resposta
- Use emojis com moderação (1-2 por mensagem)
- Seja profissional mas amigável

REGRAS CRÍTICAS:
1. Fale APENAS sobre: serviços, horários e agendamentos com ${profissionalNome}
2. Se perguntarem sobre agendamento: "Digite *'agendar'* para começar!"
3. NÃO converse sobre outros assuntos (fale que não é o foco da Markaí)
4. NUNCA mencione que vai finalizar a conversa - isso é automático
5. SEMPRE complete suas frases - NUNCA termine no meio de uma palavra


SERVIÇOS DISPONÍVEIS:
${listaServicos || 'Consulte o profissional para ver os serviços'}

EXEMPLOS DE BOAS RESPOSTAS:

Cliente: "Oi"
Markaí: "Olá! 👋 Sou a assistente do *${profissionalNome}*. Posso te ajudar a agendar um serviço! Digite *'agendar'* para começar."

Cliente: "Quanto custa?"
Markaí: "Temos vários serviços! 💰\n${listaServicos}\n\nQuer agendar? Digite *'agendar'*!"

Cliente: "Como está o tempo?"
Markaí: "Sou IA de agendamentos, não de meteorologia! 😅 Posso ajudar com horários e serviços. Digite *'agendar'* para marcar!"

IMPORTANTE: Seja BREVE mas COMPLETA. Termine suas frases de forma natural.`;

        let contexto = '';
        historico.slice(-3).forEach(h => {
            contexto += `${h.role === 'user' ? 'Cliente' : 'Markaí'}: ${h.content}\n`;
        });
        
        const prompt = `${promptSistema}\n\n${contexto}\nCliente: ${mensagem}\nMarkaí:`;
        
        const response = await axios.post(`${SPIDER_API_BASE_URL}?api_key=${SPIDER_API_TOKEN}`, {
            text: prompt
        });
        
        let resposta = response.data?.response?.trim() || 'Desculpe, não entendi.';
        
        // ✅ REMOVIDO O LIMITE DE 200 CARACTERES
        // A IA agora pode responder completamente, mas o prompt pede respostas curtas
        
        return resposta;
        
    } catch (error) {
        console.error('[IA] Erro na Spider X:', error.message);
        return `Olá! 👋 Sou a Markaí!\n\nDigite *'agendar'* para marcar horário. 😊`;
    }
}

function montarMensagemServicos(servicos, profissionalNome) {
    if (!servicos || servicos.length === 0) {
        return `📋 *Vamos agendar!*\n\n_Entre em contato com ${profissionalNome} para ver os serviços_`;
    }
    
    let msg = `📋 *Esses são os serviços disponíveis no momento. Escolha abaixo:*\n\n`;
    servicos.forEach((s, i) => {
        msg += `*${i + 1}.* ${s.name}\n   💰 R$ ${parseFloat(s.price).toFixed(2)}\n\n`;
    });
    msg += `💡 _Digite o número do serviço que você prefere_`;
    
    return msg;
}

async function finalizarAgendamento(estado, telefoneCliente, professionalId, clienteExistente = null) {
    let cliente = clienteExistente;
    
    let telefoneFormatado = telefoneCliente;
    if (!telefoneFormatado.startsWith('55')) {
        telefoneFormatado = '55' + telefoneFormatado.replace(/\D/g, '');
    }
    
    if (!cliente) {
        console.log('[IA] 📝 Criando novo cliente...');
        
        cliente = await prisma.user.create({
            data: {
                name: estado.nomeCliente,
                cpf: estado.cpfCliente,
                email: estado.emailCliente,
                phone: telefoneFormatado,
                password: estado.cpfCliente,
                type: 'CLIENT',
                isAccountActive: false
            }
        });
        
        console.log('[IA] ✅ Cliente criado! ID:', cliente.id);
    }
    
    // ============================================
    // 🔧 CORREÇÃO DO FUSO HORÁRIO (PROBLEMA PRINCIPAL)
    // ============================================
    
    // Pega a data escolhida (ex: 20/01/2026)
    const dataAgendamento = new Date(estado.diaEscolhido);
    
    // Extrai hora e minuto do horário escolhido (ex: "14:30")
    const [hora, minuto] = estado.horaEscolhida.split(':');
    
    // ✅ ANTES: setHours() convertia para UTC automaticamente
    // dataAgendamento.setHours(parseInt(hora), parseInt(minuto), 0, 0);
    
    // ✅ AGORA: Usamos strings para manter o horário local de Brasília
    const ano = dataAgendamento.getFullYear();
    const mes = String(dataAgendamento.getMonth() + 1).padStart(2, '0');
    const dia = String(dataAgendamento.getDate()).padStart(2, '0');
    
    // Monta string ISO no formato: "2026-01-20T14:30:00-03:00"
    // O "-03:00" indica fuso horário de Brasília
    const dataHoraLocal = `${ano}-${mes}-${dia}T${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00-03:00`;
    
    console.log('[IA] 🕐 Data/Hora escolhida pelo cliente:', estado.horaEscolhida);
    console.log('[IA] 📅 Data ISO gerada:', dataHoraLocal);
    
    // Cria o agendamento com a data corrigida
    const appointment = await prisma.appointment.create({
        data: {
            clientId: cliente.id,
            proId: professionalId,
            date: new Date(dataHoraLocal), // ✅ AGORA RESPEITA O FUSO DE BRASÍLIA
            status: 'PENDING',
            serviceList: estado.servicoEscolhido?.name || 'Consulta',
            totalPrice: estado.servicoEscolhido?.price || 0,
            clientConfirmed: true,
            proConfirmed: false
        }
    });
    
    console.log('[IA] 📅 Agendamento criado! ID:', appointment.id);
    console.log('[IA] 🕐 Data salva no banco:', appointment.date);
    
    iniciarVerificacaoConfirmacao(appointment.id, cliente.phone, professionalId);
    
    return `✅ *Tudo certo! Seu agendamento foi solicitado com sucesso!*\n\n📋 *Resumo Final:*\n💎 ${estado.servicoEscolhido?.name}\n👤 ${estado.nomeCliente}\n📅 ${formatarData(estado.diaEscolhido)}\n🕐 ${estado.horaEscolhida}\n\n⏳ *Aguardando confirmação do profissional...*\n\nAssim que for confirmado, você receberá uma notificação aqui no WhatsApp! 📲\n\n😊 Obrigado pela preferência!`;
}

async function verificarAgendamentoExistente(phoneNumber, data, professionalId) {
    try {
        const cliente = await prisma.user.findFirst({
            where: { phone: phoneNumber }
        });
        
        if (!cliente) return null;
        
        const dataInicio = new Date(data);
        dataInicio.setHours(0, 0, 0, 0);
        
        const dataFim = new Date(data);
        dataFim.setHours(23, 59, 59, 999);
        
        const agendamento = await prisma.appointment.findFirst({
            where: {
                clientId: cliente.id,
                proId: professionalId,
                date: { gte: dataInicio, lte: dataFim },
                status: { 
                    notIn: ['CANCELED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] 
                }
            }
        });
        
        return agendamento;
    } catch (error) {
        console.error('[IA] Erro ao verificar agendamento:', error);
        return null;
    }
}

async function buscarHorariosDisponiveis(data, agendaOcupada, horarioTrabalho, professionalId) {
    try {
        const horaInicio = horarioTrabalho.start || '08:00';
        const horaFim = horarioTrabalho.end || '18:00';
        const duracaoServico = horarioTrabalho.duration || 60;
        
        const [inicioH, inicioM] = horaInicio.split(':').map(Number);
        const [fimH, fimM] = horaFim.split(':').map(Number);
        
        const inicioEmMinutos = inicioH * 60 + inicioM;
        const fimEmMinutos = fimH * 60 + fimM;
        
        const horarios = [];
        for (let minutos = inicioEmMinutos; minutos < fimEmMinutos; minutos += duracaoServico) {
            const h = Math.floor(minutos / 60);
            const m = minutos % 60;
            horarios.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        }
        
        const agora = new Date();
        const dataEscolhida = new Date(data);
        const isHoje = dataEscolhida.toDateString() === agora.toDateString();
        
        let horariosValidos = horarios;
        
        if (isHoje) {
            const horaAtual = agora.getHours();
            const minutoAtual = agora.getMinutes();
            const agoraEmMinutos = horaAtual * 60 + minutoAtual;
            
            horariosValidos = horarios.filter(horario => {
                const [h, m] = horario.split(':').map(Number);
                const horarioEmMinutos = h * 60 + m;
                return horarioEmMinutos > (agoraEmMinutos + 15);
            });
        }
        
        const dataInicio = new Date(data);
        dataInicio.setHours(0, 0, 0, 0);
        
        const dataFim = new Date(data);
        dataFim.setHours(23, 59, 59, 999);
        
        const agendamentos = await prisma.appointment.findMany({
            where: {
                proId: professionalId,
                date: { gte: dataInicio, lte: dataFim },
                status: { not: 'CANCELED' }
            }
        });
        
        const horariosOcupados = agendamentos.map(a => {
            const dataAgendamento = new Date(a.date);
            const hora = dataAgendamento.getHours();
            const minuto = dataAgendamento.getMinutes();
            return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
        });
        
        const horariosDisponiveis = horariosValidos.filter(h => !horariosOcupados.includes(h));
        
        return horariosDisponiveis;
        
    } catch (error) {
        console.error('[IA] Erro ao buscar horários:', error);
        return [];
    }
}

function parseDataMensagem(mensagem) {
    const msgLower = mensagem.toLowerCase().trim();
    const hoje = new Date();
    
    if (msgLower === 'hoje') return hoje;
    
    if (msgLower === 'amanhã' || msgLower === 'amanha') {
        const amanha = new Date(hoje);
        amanha.setDate(amanha.getDate() + 1);
        return amanha;
    }
    
    const match = mensagem.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
        const [, dia, mes, ano] = match;
        const data = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
        if (data instanceof Date && !isNaN(data)) return data;
    }
    
    return null;
}

function formatarData(data) {
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const ano = data.getFullYear();
    const diaSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][data.getDay()];
    return `${dia}/${mes}/${ano} (${diaSemana})`;
}

function formatarCPF(cpf) {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function formatarTelefone(telefone) {
    let tel = telefone.replace(/\D/g, '');
    if (tel.startsWith('55')) {
        tel = tel.substring(2);
    }
    
    if (tel.length === 11) {
        return tel.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    } else if (tel.length === 10) {
        return tel.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    }
    return telefone;
}

function iniciarVerificacaoConfirmacao(appointmentId, telefoneCliente, professionalId) {
    console.log(`[IA] ⏳ Iniciando verificação de confirmação`);
    console.log(`[IA] Appointment ID: ${appointmentId}`);
    console.log(`[IA] Telefone cliente: ${telefoneCliente}`);
    console.log(`[IA] Professional ID: ${professionalId}`);
}

module.exports = { 
    gerarRespostaProfissional,
    processarMensagemComDebounce,
    registrarSocket
};