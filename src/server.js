// backend/src/server.js
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const MultiSessionBot = require('./services/MultiSessionBot');
const SessionPersistence = require('./services/SessionPersistence');
const OwnerBot = require('./services/OwnerBot'); // ✅ IMPORTA OWNERBOT

const app = express();

// ====================================
// CONFIGURAÇÕES MIDDLEWARE
// ====================================

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
app.get('/health', async (req, res) => {
    const uptime = process.uptime();
    const activeSessions = MultiSessionBot.sessions ? MultiSessionBot.sessions.size : 0;
    const stats = SessionPersistence.getStats();
    const healthCheck = await MultiSessionBot.healthCheck();
    
    res.json({
        status: 'ok',
        uptime: Math.floor(uptime),
        timestamp: new Date().toISOString(),
        whatsapp: {
            activeSessions,
            ready: true,
            ...healthCheck
        },
        persistence: stats
    });
});

// Nova rota para estatísticas detalhadas
app.get('/stats', async (req, res) => {
    const stats = SessionPersistence.getStats();
    const healthCheck = await MultiSessionBot.healthCheck();
    const sessionsData = SessionPersistence.getSessionsToRestore();
    
    res.json({
        persistence: stats,
        health: healthCheck,
        sessions: sessionsData.map(s => ({
            userId: s.userId,
            lastConnected: s.lastConnected,
            status: s.status
        }))
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
// KEEP-ALIVE (Anti-Hibernação Render)
// ====================================

function setupKeepAlive() {
    const PING_INTERVAL = 14 * 60 * 1000; // 14 minutos
    const APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || 'http://localhost:10000';
    
    console.log('⏰ Keep-Alive ativado (14 minutos)');
    console.log(`📍 URL: ${APP_URL}`);
    
    setInterval(async () => {
        try {
            const https = require('https');
            const http = require('http');
            const client = APP_URL.startsWith('https') ? https : http;
            
            client.get(`${APP_URL}/health`, (res) => {
                console.log(`💓 Keep-alive ping: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error('⚠️ Keep-alive falhou:', err.message);
            });
        } catch (error) {
            console.error('⚠️ Erro no keep-alive:', error.message);
        }
    }, PING_INTERVAL);
}

// ====================================
// VERIFICAÇÃO PERIÓDICA DE SAÚDE
// ====================================

function setupHealthMonitoring() {
    const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos
    
    console.log('🏥 Monitoramento de saúde ativado (a cada 5 minutos)');
    
    setInterval(async () => {
        try {
            const health = await MultiSessionBot.healthCheck();
            
            if (health.unhealthy > 0) {
                console.log('\n⚠️ ALERTA: Sessões não saudáveis detectadas');
                console.log(`├─ Total: ${health.total}`);
                console.log(`├─ Saudáveis: ${health.healthy}`);
                console.log(`└─ Não saudáveis: ${health.unhealthy}`);
                
                // Tenta reconectar sessões não saudáveis
                for (const issue of health.details) {
                    console.log(`🔄 Tentando recuperar sessão: ${issue.userId}`);
                    try {
                        await MultiSessionBot.restoreSession(issue.userId);
                    } catch (error) {
                        console.error(`❌ Falha ao recuperar ${issue.userId}:`, error.message);
                    }
                }
            } else if (health.total > 0) {
                console.log(`✅ Todas as ${health.total} sessões estão saudáveis`);
            }
            
        } catch (error) {
            console.error('❌ Erro no monitoramento de saúde:', error.message);
        }
    }, CHECK_INTERVAL);
}

// ====================================
// LIMPEZA AUTOMÁTICA DE METADADOS ÓRFÃOS
// ⚠️ APENAS LIMPA ARQUIVOS ÓRFÃOS - NUNCA DESCONECTA SESSÕES ATIVAS
// ====================================

function setupAutoCleaning() {
    const CLEAN_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas
    
    setInterval(() => {
        console.log('\n🧹 LIMPEZA AUTOMÁTICA DE METADADOS ÓRFÃOS...');
        
        try {
            // ⚠️ IMPORTANTE: Apenas limpa metadados órfãos
            // NUNCA remove sessões ativas ou com credenciais válidas
            const orphaned = SessionPersistence.cleanOrphanedMetadata();
            
            if (orphaned > 0) {
                console.log(`✅ Limpeza concluída: ${orphaned} metadados órfãos removidos`);
            } else {
                console.log(`✅ Nenhum metadado órfão encontrado`);
            }
            
        } catch (error) {
            console.error('❌ Erro na limpeza automática:', error.message);
        }
    }, CLEAN_INTERVAL);
    
    console.log('🧹 Limpeza automática ativada (apenas metadados órfãos, a cada 6 horas)');
}

// ====================================
// MONITORAMENTO DE RECURSOS
// ====================================

function logSystemStats() {
    setInterval(async () => {
        const used = process.memoryUsage();
        const activeSessions = MultiSessionBot.sessions ? MultiSessionBot.sessions.size : 0;
        const stats = SessionPersistence.getStats();
        const health = await MultiSessionBot.healthCheck();
        
        console.log('\n📊 STATUS DO SISTEMA:');
        console.log(`├─ Memória: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
        console.log(`├─ Uptime: ${Math.floor(process.uptime() / 60)} minutos`);
        console.log(`├─ Sessões WhatsApp ativas: ${activeSessions}`);
        console.log(`├─ Sessões salvas: ${stats.total}`);
        console.log(`├─ Sessões restauráveis: ${stats.restorable}`);
        console.log(`├─ Saúde: ${health.healthy}/${health.total} saudáveis`);
        console.log(`└─ Timestamp: ${new Date().toLocaleString('pt-BR')}\n`);
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
    
    // ====================================
    // 🔄 RESTAURAÇÃO AUTOMÁTICA DE SESSÕES DOS CLIENTES
    // ====================================
    
    console.log('\n' + '═'.repeat(60));
    console.log('🔄 INICIANDO RESTAURAÇÃO AUTOMÁTICA DE SESSÕES DOS CLIENTES');
    console.log('═'.repeat(60));
    
    try {
        const restoreResult = await MultiSessionBot.restoreAllSessions();
        
        if (restoreResult.restored > 0) {
            console.log('\n✅ SESSÕES DE CLIENTES RESTAURADAS COM SUCESSO!');
            console.log(`   Total processadas: ${restoreResult.total}`);
            console.log(`   Restauradas: ${restoreResult.restored}`);
            console.log(`   Falhas: ${restoreResult.failed}`);
        } else if (restoreResult.total === 0) {
            console.log('\n📂 Nenhuma sessão de cliente anterior para restaurar');
        } else {
            console.log('\n⚠️ Algumas sessões falharam ao restaurar');
            console.log(`   Restauradas: ${restoreResult.restored}`);
            console.log(`   Falhas: ${restoreResult.failed}`);
        }
        
    } catch (error) {
        console.error('\n❌ ERRO NA RESTAURAÇÃO DE CLIENTES:', error.message);
    }
    
    console.log('═'.repeat(60));
    console.log();
    
    // ====================================
    // 👑 RESTAURAÇÃO AUTOMÁTICA DO OWNER BOT
    // ====================================
    
    console.log('\n' + '👑'.repeat(60));
    console.log('🔄 VERIFICANDO SESSÃO DO OWNER BOT');
    console.log('👑'.repeat(60));
    
    try {
        const ownerRestored = await OwnerBot.restoreSession();
        
        if (ownerRestored) {
            console.log('\n✅ SESSÃO DO OWNER RESTAURADA COM SUCESSO!');
            console.log('   Owner Bot está ativo e pronto para receber mensagens');
        } else {
            console.log('\n📂 Nenhuma sessão do Owner para restaurar');
            console.log('   Owner Bot aguardando conexão manual');
        }
        
    } catch (error) {
        console.error('\n❌ ERRO NA RESTAURAÇÃO DO OWNER:', error.message);
        console.log('   Owner Bot aguardando conexão manual');
    }
    
    console.log('👑'.repeat(60));
    console.log();
    
    // ====================================
    // ATIVAÇÃO DE SERVIÇOS
    // ====================================
    
    // Ativa keep-alive
    setupKeepAlive();
    
    // Ativa monitoramento de saúde
    setupHealthMonitoring();
    
    // Ativa limpeza automática (APENAS METADADOS ÓRFÃOS)
    setupAutoCleaning();
    
    // Ativa monitoramento de recursos (se configurado)
    if (process.env.LOG_STATS === 'true' || process.env.NODE_ENV === 'development') {
        logSystemStats();
    }
    
    console.log();
    console.log('📱 WhatsApp Bot Clientes: Sessões restauradas automaticamente');
    console.log('👑 WhatsApp Bot Owner: Sessão restaurada automaticamente (se disponível)');
    console.log('💡 Sessões permanecem conectadas até desconexão manual');
    console.log('🔗 API Clientes: POST /api/whatsapp/connect');
    console.log('🔗 API Owner: POST /owner/whatsapp/connect');
    console.log('📊 Health Check: GET /health');
    console.log('📈 Estatísticas: GET /stats');
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
    
    console.log('🔌 Fechando conexões ativas...');
    
    // ✅ SALVA SESSÕES DOS CLIENTES
    if (MultiSessionBot.sessions) {
        console.log('📱 Salvando estado das sessões WhatsApp dos clientes...');
        
        const sessions = Array.from(MultiSessionBot.sessions.keys());
        
        for (const userId of sessions) {
            try {
                SessionPersistence.updateSessionStatus(userId, 'shutdown');
                console.log(`💾 Estado salvo (cliente): ${userId}`);
            } catch (error) {
                console.error(`❌ Erro ao salvar ${userId}:`, error.message);
            }
        }
    }
    
    // ✅ SALVA SESSÃO DO OWNER (se estiver conectado)
    const ownerSessionPersistence = require('./services/OwnerSessionPersistence.service');
    const ownerMetadata = ownerSessionPersistence.loadMetadata();
    
    if (ownerMetadata && ownerMetadata.connected) {
        console.log('👑 Salvando estado da sessão do Owner...');
        
        try {
            await ownerSessionPersistence.saveMetadata({
                ...ownerMetadata,
                lastActivity: new Date().toISOString()
            });
            console.log('💾 Estado salvo (Owner)');
        } catch (error) {
            console.error('❌ Erro ao salvar Owner:', error.message);
        }
    }
    
    console.log('✅ Estados salvos com sucesso');
    console.log('✅ Servidor encerrado - Sessões serão restauradas no próximo boot');
    process.exit(0);
}

// Captura sinais de encerramento
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Captura erros não tratados
process.on('uncaughtException', (error) => {
    console.error('💥 ERRO NÃO TRATADO:', error);
    console.error('Stack:', error.stack);
    
    // Salva estados antes de morrer
    if (MultiSessionBot.sessions) {
        const sessions = Array.from(MultiSessionBot.sessions.keys());
        sessions.forEach(userId => {
            SessionPersistence.updateSessionStatus(userId, 'crashed');
        });
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 PROMISE REJEITADA NÃO TRATADA:', reason);
});

// ====================================
// EXPORTAÇÃO (para testes)
// ====================================

module.exports = app;