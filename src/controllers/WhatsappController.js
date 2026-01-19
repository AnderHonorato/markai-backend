// backend/src/controllers/WhatsappController.js
const MultiSessionBot = require('../services/MultiSessionBot');

module.exports = {
    /**
     * 🔌 CONECTAR
     */
    async connect(req, res) {
        const { userId, method, phoneNumber } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        if (method === 'code' && !phoneNumber) {
            return res.status(400).json({ error: 'Número de telefone é obrigatório para código' });
        }

        try {
            console.log(`\n${'🔥'.repeat(35)}`);
            console.log(`[API] Nova conexão`);
            console.log(`[API] User: ${userId}`);
            console.log(`[API] Método: ${method}`);
            console.log(`[API] Tel: ${phoneNumber || 'N/A'}`);
            console.log(`${'🔥'.repeat(35)}\n`);
            
            const result = await MultiSessionBot.startSession(userId, method, phoneNumber);
            
            console.log(`[API] ✅ Sucesso:`, result.type);
            return res.json(result);
            
        } catch (error) {
            console.error('[API] ❌ Erro:', error.message);
            
            // Erro 515 - Outro dispositivo
            if (error.message.includes('ERRO_515')) {
                return res.status(409).json({ 
                    error: 'CONFLITO_DISPOSITIVO',
                    message: 'Outro WhatsApp está conectado neste número. Desconecte todos os dispositivos e tente novamente.',
                    solution: 'Abra WhatsApp → Dispositivos Conectados → Desconecte todos'
                });
            }
            
            // Timeout
            if (error.message.includes('TIMEOUT')) {
                return res.status(408).json({ 
                    error: 'TIMEOUT',
                    message: 'Tempo esgotado. Tente novamente.'
                });
            }
            
            // Logout/Sessão inválida
            if (error.message.includes('LOGOUT')) {
                return res.status(401).json({ 
                    error: 'SESSAO_INVALIDA',
                    message: 'Sessão inválida. Gere um novo código/QR.'
                });
            }
            
            // Erro genérico
            return res.status(500).json({ 
                error: 'FALHA_CONEXAO',
                message: error.message || 'Falha ao conectar'
            });
        }
    },

    /**
     * 🔌 DESCONECTAR
     */
    async disconnect(req, res) {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        try {
            const success = await MultiSessionBot.disconnectSession(userId);
            return res.json({ 
                success, 
                message: success ? 'Desconectado com sucesso' : 'Nenhuma sessão ativa encontrada' 
            });
        } catch (error) {
            console.error('[API] Erro ao desconectar:', error);
            return res.status(500).json({ 
                error: 'Erro ao desconectar',
                message: error.message 
            });
        }
    },

    /**
     * 📊 VERIFICAR STATUS
     */
    async getStatus(req, res) {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        try {
            const status = MultiSessionBot.getStatus(userId);
            return res.json(status);
        } catch (error) {
            console.error('[API] Erro ao verificar status:', error);
            return res.status(500).json({ 
                connected: false, 
                state: 'error',
                number: null,
                error: error.message
            });
        }
    },

    /**
     * 🧹 LIMPEZA FORÇADA (Emergência)
     */
    async forceCleanup(req, res) {
        try {
            console.log('\n🗑️ LIMPEZA FORÇADA INICIADA...\n');
            
            const cleaned = MultiSessionBot.forceCleanAllSessions();
            
            // Aguarda para garantir que arquivos foram liberados
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            console.log('✅ LIMPEZA COMPLETA!\n');
            
            return res.json({
                success: true,
                message: 'Sistema limpo completamente',
                sessionsRemoved: cleaned,
                nextStep: 'Aguarde 2 minutos antes de conectar novamente',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Erro na limpeza:', error);
            return res.status(500).json({ 
                success: false,
                error: 'Erro ao limpar',
                message: error.message 
            });
        }
    }
};