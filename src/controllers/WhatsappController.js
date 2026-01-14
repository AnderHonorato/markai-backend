const MultiSessionBot = require('../services/MultiSessionBot');

module.exports = {
    async connect(req, res) {
        const { userId, method, phoneNumber } = req.body;
        try {
            const result = await MultiSessionBot.startSession(userId, method, phoneNumber);
            return res.json(result);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Falha ao iniciar conexão.' });
        }
    },

    // --- NOVAS FUNÇÕES ---
    async disconnect(req, res) {
        const { userId } = req.body;
        const success = await MultiSessionBot.disconnectSession(userId);
        return res.json({ success });
    },

    async getStatus(req, res) {
        const { userId } = req.params;
        const status = MultiSessionBot.getStatus(userId);
        return res.json(status);
    }
};