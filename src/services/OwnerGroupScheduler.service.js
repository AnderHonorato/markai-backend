// backend/src/services/OwnerAutoMessage.scheduler.js
// ✅ SCHEDULER COMPLETO PARA ENVIO AUTOMÁTICO DE MENSAGENS NOS GRUPOS
// ⏰ SEM ENVIO IMEDIATO - APENAS CRONOMETRA
// 🔧 VERSÃO CORRIGIDA COM MÉTODO restart() E INTERVALOS FLEXÍVEIS

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const OWNER_EMAIL = 'contato.markaiapp@gmail.com';

class OwnerAutoMessageScheduler {
    constructor() {
        this.scheduledMessages = new Map(); // groupId -> intervalId
        this.messageTracking = new Map(); // groupId -> { lastSent, currentIndex }
        this.isRunning = false;
        this.ownerSocket = null;
        
        console.log('📨 OwnerAutoMessageScheduler inicializado');
    }

    /**
     * ✅ REGISTRA O SOCKET DO OWNER
     */
    setSocket(socket) {
        this.ownerSocket = socket;
        console.log('[AUTO MSG] 🔌 Socket do Owner registrado');
        
        // Se já estava rodando, reinicia com novo socket
        if (this.isRunning) {
            this.restart();
        }
    }

    /**
     * ✅ REINICIA O SCHEDULER COMPLETAMENTE
     * 🆕 MÉTODO QUE ESTAVA FALTANDO!
     */
    async restart() {
        console.log('[AUTO MSG] 🔄 REINICIANDO SCHEDULER...');
        this.stopAll();
        await this.startAll();
        console.log('[AUTO MSG] ✅ Scheduler reiniciado');
    }

    /**
     * ✅ INICIA TODAS AS MENSAGENS AUTOMÁTICAS CONFIGURADAS
     */
    async startAll() {
        if (this.isRunning) {
            console.log('[AUTO MSG] ⚠️ Scheduler já está rodando');
            return;
        }

        if (!this.ownerSocket) {
            console.log('[AUTO MSG] ❌ Socket não disponível - aguardando conexão');
            return;
        }

        try {
            console.log('\n' + '📨'.repeat(35));
            console.log('[AUTO MSG] 🚀 INICIANDO SISTEMA DE MENSAGENS AUTOMÁTICAS');
            console.log('📨'.repeat(35) + '\n');

            const owner = await prisma.user.findFirst({
                where: { email: OWNER_EMAIL },
                select: { ownerGroupConfigs: true }
            });

            if (!owner || !owner.ownerGroupConfigs) {
                console.log('[AUTO MSG] ℹ️ Nenhum grupo configurado');
                return;
            }

            const configs = owner.ownerGroupConfigs;
            let gruposAtivos = 0;

            for (const [groupId, config] of Object.entries(configs)) {
                if (config.autoMessages && config.autoMessages.length > 0) {
                    const activeMessages = config.autoMessages.filter(m => m.enabled);
                    
                    if (activeMessages.length > 0) {
                        this.scheduleGroupMessages(groupId, activeMessages);
                        gruposAtivos++;
                        
                        console.log(`[AUTO MSG] ✅ Grupo ativado: ${groupId.substring(0, 20)}...`);
                        console.log(`[AUTO MSG]    - Mensagens ativas: ${activeMessages.length}`);
                    }
                }
            }

            this.isRunning = true;
            
            console.log('\n' + '═'.repeat(70));
            console.log(`[AUTO MSG] ✅ SISTEMA INICIADO COM SUCESSO`);
            console.log(`[AUTO MSG] 📊 Total de grupos ativos: ${gruposAtivos}`);
            console.log('═'.repeat(70) + '\n');

        } catch (error) {
            console.error('[AUTO MSG] ❌ Erro ao iniciar:', error.message);
        }
    }

    /**
     * ✅ AGENDA MENSAGENS DE UM GRUPO ESPECÍFICO
     * ⏰ SEM ENVIO IMEDIATO - APENAS CRONOMETRA
     * 🆕 SUPORTA INTERVALOS EM MINUTOS, HORAS OU DIAS
     */
    scheduleGroupMessages(groupId, messages) {
        // Para qualquer agendamento anterior
        if (this.scheduledMessages.has(groupId)) {
            clearInterval(this.scheduledMessages.get(groupId));
            clearTimeout(this.scheduledMessages.get(groupId));
        }

        // Inicializa tracking
        this.messageTracking.set(groupId, {
            lastSent: null,
            currentIndex: 0
        });

        // ⏰ AGENDA PRIMEIRA MENSAGEM (SEM ENVIO IMEDIATO)
        const firstMessage = messages[0];
        const firstIntervalMs = this.convertIntervalToMs(firstMessage);
        
        console.log(`[AUTO MSG] 📅 Grupo agendado: ${groupId.substring(0, 20)}...`);
        console.log(`[AUTO MSG]    - Primeira mensagem em: ${this.formatInterval(firstMessage)}`);
        
        // Agenda primeira mensagem
        const timerId = setTimeout(() => {
            this.sendNextMessage(groupId, messages);
        }, firstIntervalMs);
        
        this.scheduledMessages.set(groupId, timerId);
    }

    /**
     * 🆕 CONVERTE INTERVALO PARA MILISSEGUNDOS
     * Suporta: intervalMinutes, intervalHours, intervalDays
     */
    convertIntervalToMs(message) {
        // Prioridade: days > hours > minutes
        if (message.intervalDays && message.intervalDays > 0) {
            return message.intervalDays * 24 * 60 * 60 * 1000;
        }
        
        if (message.intervalHours && message.intervalHours > 0) {
            return message.intervalHours * 60 * 60 * 1000;
        }
        
        // Padrão: minutos
        const minutes = message.intervalMinutes || 60;
        return minutes * 60 * 1000;
    }

    /**
     * 🆕 FORMATA INTERVALO PARA EXIBIÇÃO
     */
    formatInterval(message) {
        if (message.intervalDays && message.intervalDays > 0) {
            return `${message.intervalDays} dia(s)`;
        }
        
        if (message.intervalHours && message.intervalHours > 0) {
            return `${message.intervalHours} hora(s)`;
        }
        
        const minutes = message.intervalMinutes || 60;
        return `${minutes} minuto(s)`;
    }

    /**
     * ✅ ENVIA PRÓXIMA MENSAGEM DO GRUPO
     */
    async sendNextMessage(groupId, messages) {
        if (!this.ownerSocket) {
            console.log('[AUTO MSG] ⚠️ Socket não disponível - pulando envio');
            return;
        }

        try {
            const tracking = this.messageTracking.get(groupId);
            
            if (!tracking) {
                console.log('[AUTO MSG] ⚠️ Tracking não encontrado:', groupId);
                return;
            }

            // Pega a mensagem atual
            const currentMessage = messages[tracking.currentIndex];
            
            if (!currentMessage || !currentMessage.enabled) {
                // Pula para próxima
                tracking.currentIndex = (tracking.currentIndex + 1) % messages.length;
                this.scheduleNext(groupId, messages);
                return;
            }

            console.log(`\n[AUTO MSG] 📤 ENVIANDO MENSAGEM AUTOMÁTICA`);
            console.log(`[AUTO MSG]    - Grupo: ${groupId.substring(0, 20)}...`);
            console.log(`[AUTO MSG]    - Mensagem ${tracking.currentIndex + 1}/${messages.length}`);
            console.log(`[AUTO MSG]    - Intervalo: ${this.formatInterval(currentMessage)}`);

            // Monta a mensagem
            const messageOptions = {};

            // Se tem imagem
            if (currentMessage.image) {
                messageOptions.image = { url: currentMessage.image };
                
                // Caption (texto) se tiver
                if (currentMessage.text && currentMessage.text.trim()) {
                    messageOptions.caption = currentMessage.text.trim();
                }
            } 
            // Se tem apenas texto
            else if (currentMessage.text && currentMessage.text.trim()) {
                messageOptions.text = currentMessage.text.trim();
            }
            // Se não tem nada, pula
            else {
                console.log('[AUTO MSG] ⚠️ Mensagem vazia - pulando');
                tracking.currentIndex = (tracking.currentIndex + 1) % messages.length;
                this.scheduleNext(groupId, messages);
                return;
            }

            // Envia a mensagem
            await this.ownerSocket.sendMessage(groupId, messageOptions);

            console.log('[AUTO MSG] ✅ Mensagem enviada com sucesso!');

            // Atualiza tracking
            tracking.lastSent = new Date();
            tracking.currentIndex = (tracking.currentIndex + 1) % messages.length;

            // Agenda próxima mensagem
            this.scheduleNext(groupId, messages, currentMessage);

        } catch (error) {
            console.error('[AUTO MSG] ❌ Erro ao enviar:', error.message);
            
            // Mesmo com erro, tenta próxima
            const tracking = this.messageTracking.get(groupId);
            if (tracking) {
                tracking.currentIndex = (tracking.currentIndex + 1) % messages.length;
                this.scheduleNext(groupId, messages);
            }
        }
    }

    /**
     * ✅ AGENDA PRÓXIMA MENSAGEM
     * 🆕 AGORA ACEITA O OBJETO COMPLETO DA MENSAGEM
     */
    scheduleNext(groupId, messages, lastMessage = null) {
        // Para timer anterior se existir
        if (this.scheduledMessages.has(groupId)) {
            clearTimeout(this.scheduledMessages.get(groupId));
        }

        // Pega a próxima mensagem
        const tracking = this.messageTracking.get(groupId);
        const nextMessage = messages[tracking.currentIndex];
        
        // Usa o intervalo da última mensagem enviada (se fornecido) ou da próxima
        const intervalMs = lastMessage 
            ? this.convertIntervalToMs(lastMessage)
            : this.convertIntervalToMs(nextMessage || { intervalMinutes: 60 });

        console.log(`[AUTO MSG] ⏰ Próximo envio em ${this.formatInterval(lastMessage || nextMessage || { intervalMinutes: 60 })}`);

        // Agenda próximo envio
        const timerId = setTimeout(() => {
            this.sendNextMessage(groupId, messages);
        }, intervalMs);

        this.scheduledMessages.set(groupId, timerId);
    }

    /**
     * ✅ PARA TODAS AS MENSAGENS AUTOMÁTICAS
     */
    stopAll() {
        console.log('\n[AUTO MSG] 🛑 PARANDO SISTEMA DE MENSAGENS AUTOMÁTICAS...');

        for (const [groupId, timerId] of this.scheduledMessages.entries()) {
            clearInterval(timerId);
            clearTimeout(timerId);
            console.log(`[AUTO MSG] ⏹️ Grupo desativado: ${groupId.substring(0, 20)}...`);
        }

        this.scheduledMessages.clear();
        this.messageTracking.clear();
        this.isRunning = false;

        console.log('[AUTO MSG] ✅ Sistema parado\n');
    }

    /**
     * ✅ RECARREGA CONFIGURAÇÕES DE UM GRUPO ESPECÍFICO
     */
    async reloadGroup(groupId) {
        try {
            console.log(`[AUTO MSG] 🔄 Recarregando grupo: ${groupId}`);

            // Para mensagens antigas
            if (this.scheduledMessages.has(groupId)) {
                clearInterval(this.scheduledMessages.get(groupId));
                clearTimeout(this.scheduledMessages.get(groupId));
                this.scheduledMessages.delete(groupId);
            }
            this.messageTracking.delete(groupId);

            // Busca nova configuração
            const owner = await prisma.user.findFirst({
                where: { email: OWNER_EMAIL },
                select: { ownerGroupConfigs: true }
            });

            const configs = owner?.ownerGroupConfigs || {};
            const groupConfig = configs[groupId];

            if (!groupConfig || !groupConfig.autoMessages || groupConfig.autoMessages.length === 0) {
                console.log('[AUTO MSG] ℹ️ Grupo sem mensagens configuradas');
                return;
            }

            const activeMessages = groupConfig.autoMessages.filter(m => m.enabled);

            if (activeMessages.length === 0) {
                console.log('[AUTO MSG] ℹ️ Nenhuma mensagem ativa');
                return;
            }

            // Reagenda
            this.scheduleGroupMessages(groupId, activeMessages);
            console.log(`[AUTO MSG] ✅ Grupo recarregado: ${activeMessages.length} mensagens ativas`);

        } catch (error) {
            console.error('[AUTO MSG] ❌ Erro ao recarregar grupo:', error.message);
        }
    }

    /**
     * ✅ STATUS DO SCHEDULER
     */
    getStatus() {
        const groups = [];

        for (const [groupId, tracking] of this.messageTracking.entries()) {
            groups.push({
                groupId: groupId.substring(0, 20) + '...',
                currentIndex: tracking.currentIndex,
                lastSent: tracking.lastSent,
                isActive: this.scheduledMessages.has(groupId)
            });
        }

        return {
            isRunning: this.isRunning,
            hasSocket: !!this.ownerSocket,
            totalGroups: groups.length,
            groups
        };
    }
}

// ✅ EXPORTA SINGLETON
const scheduler = new OwnerAutoMessageScheduler();

module.exports = scheduler;