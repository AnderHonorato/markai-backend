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
    console.log(`📱 WhatsApp Bot: Use a tela de configuração no app para conectar`);
    
    // COMENTADO: O bot agora é iniciado manualmente via /whatsapp/connect
    // setTimeout(() => {
    //     try {
    //         console.log('🤖 Tentando iniciar Bot do WhatsApp...');
    //         startBot("ID_DO_PROFISSIONAL_PADRAO"); 
    //     } catch (error) {
    //         console.error('⚠️ O Bot falhou ao iniciar.');
    //     }
    // }, 5000);
});