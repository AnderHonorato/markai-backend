const express = require('express');
const cors = require('cors');
const { startBot } = require('./bot'); 
const routes = require('./routes'); 

const app = express();

// Configurações de limite para imagens (Essencial para Base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Middleware de log para monitorar as tentativas de cadastro no Render
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Usa as rotas (Prioridade para UserController)
app.use(routes);

// Middleware de erro global
app.use((err, req, res, next) => {
    console.error('❌ Erro no Servidor:', err.message);
    res.status(500).json({ error: 'Erro interno no servidor', details: err.message });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Servidor V5 rodando na porta ${PORT}`);
    
    // Inicia o Bot com proteção para não travar o cadastro se o WhatsApp falhar
    setTimeout(() => {
        try {
            console.log('🤖 Tentando iniciar Bot do WhatsApp...');
            startBot();
        } catch (error) {
            console.error('⚠️ O Bot falhou ao iniciar, mas o sistema de cadastro segue ativo.');
        }
    }, 5000); // Aguarda 5 segundos para o servidor estabilizar antes de ligar o bot
});