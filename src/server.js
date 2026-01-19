// backend/src/server.js
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const MultiSessionBot = require('./services/MultiSessionBot');

const app = express();

// ====================================
// CONFIGURAÇÕES MIDDLEWARE
// ====================================

// Limite para imagens Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Log de requisições
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url.includes('/whatsapp')) {
        console.log('📥', req.method, req.url);
    }
    next();
});

// ====================================
// ROTAS
// ====================================

app.use(routes);

// Rota de health check (para monitoramento)
app.get('/health', (req, res) => {
    const uptime = process.uptime();
    const activeSessions = MultiSessionBot.sessions ? MultiSessionBot.sessions.size : 0;
    
    res.json({
        status: 'ok',
        uptime: Math.floor(uptime),
        timestamp: new Date().toISOString(),
        whatsapp: {
            activeSessions,
            ready: true
        }
    });
});

// Middleware de erro global
app.use((err, req, res, next) => {
    console.error('❌ Erro no Servidor:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ 
        error: 'Erro interno no servidor', 
        details: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno'
    });
});

// ====================================
// RESTAURAÇÃO DE SESSÕES (OPCIONAL)
// ====================================

async function restoreSessions() {
    console.log('\n🔄 RESTAURANDO SESSÕES SALVAS...');
    
    try {
        const fs = require('fs');
        const path = require('path');
        const authDir = path.join(__dirname, '../auth_sessions');
        
        if (!fs.existsSync(authDir)) {
            console.log('📂 Nenhuma sessão anterior encontrada');
            return;
        }

        const sessions = fs.readdirSync(authDir).filter(dir => dir.startsWith('session_'));
        console.log(`📂 Encontradas ${sessions.length} sessões`);
        
        if (sessions.length === 0) {
            console.log('✅ RESTAURAÇÃO COMPLETA: 0 sessões ativas');
            return;
        }

        // Tenta restaurar cada sessão
        let restored = 0;
        for (const sessionDir of sessions) {
            try {
                const userId = sessionDir.replace('session_', '');
                const sessionPath = path.join(authDir, sessionDir);
                
                // Verifica se tem credenciais
                const credsFile = path.join(sessionPath, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    console.log(`🔄 Tentando restaurar sessão: ${userId}`);
                    
                    // Tenta reconectar automaticamente
                    await MultiSessionBot.startSession(userId, 'qr');
                    restored++;
                    
                    console.log(`✅ Sessão ${userId} restaurada`);
                } else {
                    console.log(`⚠️ Sessão ${userId} sem credenciais, removendo...`);
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
            } catch (error) {
                console.error(`❌ Erro ao restaurar sessão ${sessionDir}:`, error.message);
            }
        }
        
        console.log(`✅ RESTAURAÇÃO COMPLETA: ${restored} sessões ativas\n`);
        
    } catch (error) {
        console.error('❌ Erro na restauração de sessões:', error.message);
    }
}

// ====================================
// KEEP-ALIVE (Anti-Hibernação Render)
// ====================================

function setupKeepAlive() {
    const PING_INTERVAL = 14 * 60 * 1000; // 14 minutos
    const APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://markai-backend.onrender.com';
    
    if (process.env.NODE_ENV === 'production') {
        console.log('⏰ Keep-Alive ativado (14 minutos)');
        
        setInterval(async () => {
            try {
                const https = require('https');
                https.get(`${APP_URL}/health`, (res) => {
                    console.log(`💓 Keep-alive ping: ${res.statusCode}`);
                }).on('error', (err) => {
                    console.error('⚠️ Keep-alive falhou:', err.message);
                });
            } catch (error) {
                console.error('⚠️ Erro no keep-alive:', error.message);
            }
        }, PING_INTERVAL);
    }
}

// ====================================
// LIMPEZA AUTOMÁTICA PERIÓDICA
// ====================================

function setupAutoCleaning() {
    // Limpa sessões mortas a cada 6 horas
    const CLEAN_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas
    
    setInterval(() => {
        console.log('\n🧹 LIMPEZA AUTOMÁTICA INICIADA...');
        
        try {
            const fs = require('fs');
            const path = require('path');
            const authDir = path.join(__dirname, '../auth_sessions');
            
            if (!fs.existsSync(authDir)) return;
            
            const sessions = fs.readdirSync(authDir).filter(dir => dir.startsWith('session_'));
            let cleaned = 0;
            
            for (const sessionDir of sessions) {
                const userId = sessionDir.replace('session_', '');
                const status = MultiSessionBot.getStatus(userId);
                
                // Remove sessões desconectadas
                if (!status.connected && status.state === 'disconnected') {
                    console.log(`🗑️ Removendo sessão morta: ${userId}`);
                    MultiSessionBot.cleanupSession(userId);
                    cleaned++;
                }
            }
            
            console.log(`✅ Limpeza concluída: ${cleaned} sessões removidas\n`);
            
        } catch (error) {
            console.error('❌ Erro na limpeza automática:', error.message);
        }
    }, CLEAN_INTERVAL);
    
    console.log('🧹 Limpeza automática ativada (a cada 6 horas)');
}

// ====================================
// MONITORAMENTO DE RECURSOS
// ====================================

function logSystemStats() {
    setInterval(() => {
        const used = process.memoryUsage();
        const activeSessions = MultiSessionBot.sessions ? MultiSessionBot.sessions.size : 0;
        
        console.log('\n📊 STATUS DO SISTEMA:');
        console.log(`├─ Memória: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
        console.log(`├─ Uptime: ${Math.floor(process.uptime() / 60)} minutos`);
        console.log(`└─ Sessões WhatsApp ativas: ${activeSessions}\n`);
    }, 30 * 60 * 1000); // A cada 30 minutos
}

// ====================================
// INICIALIZAÇÃO DO SERVIDOR
// ====================================

const PORT = process.env.PORT || 10000;

app.listen(PORT, async () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SERVIDOR MARKAÍ INICIADO');
    console.log('='.repeat(60));
    console.log(`📍 Porta: ${PORT}`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📅 Data: ${new Date().toLocaleString('pt-BR')}`);
    console.log('='.repeat(60));
    console.log();
    
    // Carrega rotas
    console.log('✅ Rotas carregadas com sucesso');
    
    // Restaura sessões anteriores (OPCIONAL - comente se não quiser auto-restore)
    // await restoreSessions();
    
    // Ativa keep-alive em produção
    if (process.env.NODE_ENV === 'production' || process.env.RENDER_EXTERNAL_URL) {
        setupKeepAlive();
    }
    
    // Ativa limpeza automática
    setupAutoCleaning();
    
    // Ativa monitoramento de recursos
    if (process.env.LOG_STATS === 'true') {
        logSystemStats();
    }
    
    console.log();
    console.log('📱 WhatsApp Bot: Use a tela de configuração no app para conectar');
    console.log('🔗 API: POST /whatsapp/connect');
    console.log('📊 Health Check: GET /health');
    console.log();
    console.log('='.repeat(60));
    console.log('✅ SERVIDOR PRONTO PARA RECEBER CONEXÕES');
    console.log('='.repeat(60));
    console.log();
});

// ====================================
// TRATAMENTO DE SINAIS DE ENCERRAMENTO
// ====================================

async function gracefulShutdown(signal) {
    console.log(`\n⚠️ ${signal} recebido. Encerrando servidor graciosamente...`);
    
    // Para de aceitar novas conexões
    console.log('🔌 Fechando conexões ativas...');
    
    // Desconecta todas as sessões WhatsApp
    if (MultiSessionBot.sessions) {
        console.log('📱 Desconectando sessões WhatsApp...');
        const sessions = Array.from(MultiSessionBot.sessions.keys());
        
        for (const userId of sessions) {
            try {
                await MultiSessionBot.disconnectSession(userId);
                console.log(`✅ Sessão ${userId} desconectada`);
            } catch (error) {
                console.error(`❌ Erro ao desconectar ${userId}:`, error.message);
            }
        }
    }
    
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
}

// Captura sinais de encerramento
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Captura erros não tratados
process.on('uncaughtException', (error) => {
    console.error('💥 ERRO NÃO TRATADO:', error);
    console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 PROMISE REJEITADA NÃO TRATADA:', reason);
});

// ====================================
// EXPORTAÇÃO (para testes)
// ====================================

module.exports = app;