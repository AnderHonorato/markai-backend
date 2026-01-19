const MultiSessionBot = require('../services/MultiSessionBot');

module.exports = {
    async connect(req, res) {
        const { userId, method, phoneNumber } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        if (method === 'code' && !phoneNumber) {
            return res.status(400).json({ error: 'Número de telefone é obrigatório' });
        }

        try {
            console.log(`\n${'🔥'.repeat(35)}`);
            console.log(`[API] Nova conexão`);
            console.log(`[API] User: ${userId}`);
            console.log(`[API] Método: ${method}`);
            console.log(`[API] Tel: ${phoneNumber || 'N/A'}`);
            console.log(`${'🔥'.repeat(35)}\n`);
            
            const result = await MultiSessionBot.startSession(userId, method, phoneNumber);
            
            console.log(`[API] ✅ ${result.type}`);
            return res.json(result);
            
        } catch (error) {
            console.error('[API] ❌ Erro:', error.message);
            
            // Erro 515 com número de tentativas
            if (error.message.includes('ERRO_515_PERSISTENTE')) {
                const attempts = error.message.split('_').pop();
                return res.status(409).json({ 
                    error: 'CONFLITO_DISPOSITIVO',
                    message: `Outro dispositivo conectado (tentativa ${attempts}/3)`,
                    solution: attempts >= 3 
                        ? 'Bloqueado. Use POST /whatsapp/force-cleanup e aguarde 2 minutos'
                        : 'Desconecte todos os dispositivos no WhatsApp e tente novamente'
                });
            }
            
            if (error.message.includes('BLOQUEIO_TEMPORARIO')) {
                return res.status(429).json({ 
                    error: 'BLOQUEIO_TEMPORARIO',
                    message: 'Muitas tentativas com erro 515. Execute limpeza forçada.',
                    action: 'POST /whatsapp/force-cleanup'
                });
            }
            
            if (error.message.includes('TIMEOUT')) {
                return res.status(408).json({ 
                    error: 'Tempo esgotado' 
                });
            }
            
            if (error.message.includes('CODIGO_EXPIRADO')) {
                return res.status(401).json({ 
                    error: 'Código expirou. Gere novo código.' 
                });
            }
            
            return res.status(500).json({ 
                error: error.message || 'Falha ao conectar' 
            });
        }
    },

    async disconnect(req, res) {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        try {
            const success = await MultiSessionBot.disconnectSession(userId);
            return res.json({ 
                success, 
                message: success ? 'Desconectado' : 'Nenhuma sessão ativa' 
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao desconectar' });
        }
    },

    async getStatus(req, res) {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        try {
            const status = MultiSessionBot.getStatus(userId);
            return res.json(status);
        } catch (error) {
            return res.status(500).json({ 
                connected: false, 
                number: null,
                error: 'Erro ao verificar status' 
            });
        }
    },

    /**
     * 🆕 LIMPEZA FORÇADA - Use quando erro 515 persistir
     */
    async forceCleanup(req, res) {
        try {
            console.log('\n🗑️ LIMPEZA FORÇADA INICIADA...\n');
            
            // Encerra todas as sessões ativas
            const activeSessions = Array.from(MultiSessionBot.sessions || new Map());
            for (const [userId, sock] of activeSessions) {
                try {
                    sock.end();
                    console.log(`✅ Sessão ${userId} encerrada`);
                } catch (e) {}
            }
            
            // Limpa memória
            if (MultiSessionBot.sessions) {
                MultiSessionBot.sessions.clear();
            }
            
            // Remove TODOS os arquivos
            const cleaned = MultiSessionBot.forceCleanAllSessions();
            
            // Aguarda
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            console.log('✅ LIMPEZA COMPLETA!\n');
            
            return res.json({
                success: true,
                message: 'Sistema limpo completamente',
                cleaned: cleaned,
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