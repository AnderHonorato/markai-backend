// backend/src/controllers/WhatsappController.js
const MultiSessionBot = require('../services/MultiSessionBot');

module.exports = {
    /**
     * 🔌 CONECTAR
     */
    async connect(req, res) {
        const { userId, method, phoneNumber } = req.body;
        
        console.log(`\n${'🔥'.repeat(35)}`);
        console.log(`[API] Requisição de conexão recebida`);
        console.log(`[API] User: ${userId} | Método: ${method}`);
        console.log(`${'🔥'.repeat(35)}\n`);
        
        if (!userId) {
            return res.status(400).json({ 
                error: 'VALIDACAO',
                message: 'userId é obrigatório' 
            });
        }

        if (method === 'code' && !phoneNumber) {
            return res.status(400).json({ 
                error: 'VALIDACAO',
                message: 'Número de telefone é obrigatório para pairing code' 
            });
        }

        try {
            const result = await MultiSessionBot.startSession(userId, method, phoneNumber);
            console.log(`[API] ✅ Resultado enviado ao cliente:`, result.type);
            return res.json(result);
            
        } catch (error) {
            console.error('[API] ❌ Erro no fluxo de conexão:', error.message);
            
            if (error.message.includes('CONEXAO_JA_EM_ANDAMENTO')) {
                return res.status(409).json({ 
                    error: 'DUPLICACAO',
                    message: 'Uma conexão já está sendo processada. Aguarde.' 
                });
            }

            return res.status(500).json({ 
                error: 'FALHA_CONEXAO',
                message: error.message || 'Erro interno ao tentar conectar.' 
            });
        }
    },

    /**
     * 🔌 DESCONECTAR USUÁRIO
     */
    async disconnect(req, res) {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'VALIDACAO', message: 'userId é obrigatório' });
        }

        try {
            console.log(`[API] 🔌 Solicitando desconexão para: ${userId}`);
            const success = await MultiSessionBot.disconnectSession(userId);
            
            return res.json({ 
                success, 
                message: success ? 'Sessão encerrada e limpa.' : 'Nenhuma sessão ativa encontrada.' 
            });
        } catch (error) {
            console.error('[API] ❌ Erro ao desconectar:', error);
            return res.status(500).json({ error: 'ERRO_DESCONEXAO', message: error.message });
        }
    },

    /**
     * 📊 STATUS DA SESSÃO
     */
    async getStatus(req, res) {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ error: 'VALIDACAO', message: 'userId é obrigatório' });
        }

        try {
            const status = MultiSessionBot.getStatus(userId);
            return res.json(status);
        } catch (error) {
            return res.status(500).json({ 
                connected: false, 
                state: 'error',
                message: error.message
            });
        }
    },

    /**
     * 🧹 LIMPEZA FORÇADA (O QUE RESOLVE O ERRO TYPEERROR)
     */
    async forceCleanup(req, res) {
        try {
            console.log('\n' + '═'.repeat(40));
            console.log('🗑️  EXECUTANDO LIMPEZA TOTAL DO SISTEMA');
            console.log('═'.repeat(40));
            
            // Chama a função que acabamos de criar no MultiSessionBot.js
            const cleanedCount = await MultiSessionBot.forceCleanAllSessions();
            
            // Aguarda 3 segundos para o sistema de arquivos liberar as travas
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            return res.json({
                success: true,
                message: 'Limpeza global concluída com sucesso.',
                sessionsRemoved: cleanedCount,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Erro fatal na limpeza forçada:', error);
            return res.status(500).json({ 
                success: false,
                error: 'ERRO_LIMPEZA',
                message: error.message 
            });
        }
    }
};