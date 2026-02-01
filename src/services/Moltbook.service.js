const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ✅ URL CORRETA da API (subdomain api, não www)
const MOLTBOOK_BASE_URL = 'https://api.moltbook.com/v1';

// ✅ Caminho absoluto garantido → backend/src/config/moltbook-credentials.json
const CREDENTIALS_PATH = path.resolve(__dirname, '..', 'config', 'moltbook-credentials.json');

/**
 * 🦞 Moltbook Service
 * - URL base corrigida para api.moltbook.com
 * - Retry com exponential backoff no registro
 * - path.resolve para garantir caminho absoluto
 * - Todos os métodos envolvidos em try-catch
 * - Health checks periódicos
 */
class MoltbookService {
    constructor() {
        this.baseUrl = MOLTBOOK_BASE_URL;
        this.credentials = null;
        this.isHealthy = false;
        this.lastHealthCheck = null;
        this.healthCheckInterval = null;

        this.initialize();
    }

    // ═══════════════════════════════════════════════════════════
    // 🔧 INICIALIZAÇÃO
    // ═══════════════════════════════════════════════════════════

    initialize() {
        try {
            this.loadCredentials();
            this.startHealthChecks();
        } catch (error) {
            this.logError('initialize', error);
        }
    }

    loadCredentials() {
        try {
            if (!fs.existsSync(CREDENTIALS_PATH)) {
                this.log('warn', 'Credenciais não encontradas', { path: CREDENTIALS_PATH });
                return false;
            }

            const data = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
            this.credentials = JSON.parse(data);

            if (!this.credentials?.api_key) {
                this.log('warn', 'API key não encontrada nas credenciais');
                return false;
            }

            this.log('info', 'Credenciais carregadas', {
                name: this.credentials.name,
                keyPrefix: this.credentials.api_key.substring(0, 15) + '...'
            });
            return true;
        } catch (error) {
            this.logError('loadCredentials', error);
            return false;
        }
    }

    saveCredentials(credentials) {
        try {
            const dir = path.dirname(CREDENTIALS_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
            this.credentials = credentials;
            this.log('info', '✅ Credenciais salvas', { path: CREDENTIALS_PATH, name: credentials.name });
            return true;
        } catch (error) {
            this.logError('saveCredentials', error);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 🏥 HEALTH CHECKS
    // ═══════════════════════════════════════════════════════════

    startHealthChecks() {
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, 5 * 60 * 1000);

        setTimeout(() => this.performHealthCheck(), 10000);
    }

    async performHealthCheck() {
        try {
            if (!this.credentials?.api_key) {
                this.isHealthy = false;
                return;
            }

            const status = await this.checkStatus();

            if (status && status.status === 'claimed') {
                this.isHealthy = true;
                this.lastHealthCheck = new Date();
                this.log('info', 'Health check OK');
            } else {
                this.isHealthy = false;
            }
        } catch (error) {
            this.isHealthy = false;
            this.logError('performHealthCheck', error);
        }
    }

    getHealthStatus() {
        return {
            healthy: this.isHealthy,
            hasCredentials: !!this.credentials?.api_key,
            lastCheck: this.lastHealthCheck,
            agentName: this.credentials?.name || 'N/A'
        };
    }

    // ═══════════════════════════════════════════════════════════
    // 🔄 RETRY COM EXPONENTIAL BACKOFF
    // ═══════════════════════════════════════════════════════════

    async withRetry(fn, { maxRetries = 3, baseDelay = 3000, label = 'operation' } = {}) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.log('info', `${label} — tentativa ${attempt}/${maxRetries}`);
                return await fn();
            } catch (error) {
                lastError = error;

                // Não faz retry em erros de cliente (4xx)
                if (error.response) {
                    const s = error.response.status;
                    if (s === 400 || s === 401 || s === 403 || s === 404 || s === 429) {
                        this.log('warn', `${label} — erro ${s}, sem retry`);
                        throw error;
                    }
                }

                if (attempt < maxRetries) {
                    const delay = baseDelay * Math.pow(2, attempt - 1); // 3s → 6s → 12s
                    this.log('warn', `${label} — falhou, aguardando ${(delay / 1000).toFixed(0)}s...`, {
                        erro: error.message
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        this.log('error', `${label} — todas as ${maxRetries} tentativas falharam`);
        throw lastError;
    }

    // ═══════════════════════════════════════════════════════════
    // 🔑 REGISTRO E CLAIM
    // ═══════════════════════════════════════════════════════════

    async register(name, twitterHandle = null) {
        try {
            this.log('info', 'Iniciando registro', { name, url: `${this.baseUrl}/agents/register` });

            const response = await this.withRetry(
                () => axios.post(
                    `${this.baseUrl}/agents/register`,
                    { name, twitter_handle: twitterHandle },
                    {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 45000
                    }
                ),
                { maxRetries: 3, baseDelay: 3000, label: `registro(${name})` }
            );

            if (response.data && response.data.api_key) {
                const credentials = {
                    name: name,
                    api_key: response.data.api_key,
                    claim_url: response.data.claim_url,
                    registered_at: new Date().toISOString()
                };

                this.saveCredentials(credentials);

                this.log('success', 'Registro concluído', { name, claim_url: response.data.claim_url });
                return { success: true, data: response.data };
            }

            return { success: false, error: 'Resposta inválida do servidor' };
        } catch (error) {
            return this.handleApiError('register', error);
        }
    }

    async checkStatus() {
        try {
            if (!this.credentials?.api_key) {
                return { success: false, error: 'Sem credenciais configuradas' };
            }

            const response = await axios.get(
                `${this.baseUrl}/agents/status`,
                { headers: this.getHeaders(), timeout: 15000 }
            );

            return { success: true, ...response.data };
        } catch (error) {
            return this.handleApiError('checkStatus', error);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 👤 PERFIL
    // ═══════════════════════════════════════════════════════════

    async getMyProfile() {
        try {
            if (!this.ensureCredentials()) return null;

            const response = await axios.get(
                `${this.baseUrl}/agents/me`,
                { headers: this.getHeaders(), timeout: 15000 }
            );

            return { success: true, ...response.data };
        } catch (error) {
            return this.handleApiError('getMyProfile', error);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 📝 POSTS
    // ═══════════════════════════════════════════════════════════

    async createPost(submolt, title, content) {
        try {
            if (!this.ensureCredentials()) {
                return { success: false, error: 'Credenciais não configuradas' };
            }

            this.log('info', 'Criando post', { submolt, title: title.substring(0, 50) });

            const response = await axios.post(
                `${this.baseUrl}/posts`,
                { submolt: submolt || 'general', title, content },
                { headers: this.getHeaders(), timeout: 20000 }
            );

            this.log('success', 'Post criado', { id: response.data?.post?.id });
            return { success: true, ...response.data };
        } catch (error) {
            if (error.response?.status === 429) {
                const retryAfter = error.response.data?.retry_after_minutes || 30;
                this.log('warn', 'Rate limit atingido', { retry_after_minutes: retryAfter });
                return { success: false, error: 'cooldown', retry_after_minutes: retryAfter };
            }
            return this.handleApiError('createPost', error);
        }
    }

    async getPost(postId) {
        try {
            if (!this.ensureCredentials()) return null;

            const response = await axios.get(
                `${this.baseUrl}/posts/${postId}`,
                { headers: this.getHeaders(), timeout: 15000 }
            );

            return { success: true, ...response.data };
        } catch (error) {
            return this.handleApiError('getPost', error);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 📰 FEED E BUSCA
    // ═══════════════════════════════════════════════════════════

    async getFeed(sort = 'hot', limit = 10) {
        try {
            if (!this.ensureCredentials()) return null;

            const response = await axios.get(
                `${this.baseUrl}/feed?sort=${sort}&limit=${limit}`,
                { headers: this.getHeaders(), timeout: 15000 }
            );

            return { success: true, ...response.data };
        } catch (error) {
            return this.handleApiError('getFeed', error);
        }
    }

    async search(query, limit = 10) {
        try {
            if (!this.ensureCredentials()) return null;

            const response = await axios.get(
                `${this.baseUrl}/search?q=${encodeURIComponent(query)}&limit=${limit}`,
                { headers: this.getHeaders(), timeout: 15000 }
            );

            return { success: true, ...response.data };
        } catch (error) {
            return this.handleApiError('search', error);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 💬 COMENTÁRIOS E INTERAÇÕES
    // ═══════════════════════════════════════════════════════════

    async commentOnPost(postId, content) {
        try {
            if (!this.ensureCredentials()) return null;

            const response = await axios.post(
                `${this.baseUrl}/posts/${postId}/comments`,
                { content },
                { headers: this.getHeaders(), timeout: 15000 }
            );

            this.log('success', 'Comentário enviado', { postId });
            return { success: true, ...response.data };
        } catch (error) {
            return this.handleApiError('commentOnPost', error);
        }
    }

    async upvotePost(postId) {
        try {
            if (!this.ensureCredentials()) return null;

            const response = await axios.post(
                `${this.baseUrl}/posts/${postId}/upvote`,
                {},
                { headers: this.getHeaders(), timeout: 10000 }
            );

            return { success: true, ...response.data };
        } catch (error) {
            return this.handleApiError('upvotePost', error);
        }
    }

    async downvotePost(postId) {
        try {
            if (!this.ensureCredentials()) return null;

            const response = await axios.post(
                `${this.baseUrl}/posts/${postId}/downvote`,
                {},
                { headers: this.getHeaders(), timeout: 10000 }
            );

            return { success: true, ...response.data };
        } catch (error) {
            return this.handleApiError('downvotePost', error);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 🛠️ UTILIDADES
    // ═══════════════════════════════════════════════════════════

    getHeaders() {
        if (!this.credentials?.api_key) {
            throw new Error('API key não configurada');
        }
        return {
            'Authorization': `Bearer ${this.credentials.api_key}`,
            'Content-Type': 'application/json'
        };
    }

    ensureCredentials() {
        if (!this.credentials?.api_key) {
            this.log('warn', 'Tentando operação sem credenciais');
            return false;
        }
        return true;
    }

    handleApiError(method, error) {
        const errorData = { success: false, method, error: error.message };

        if (error.response) {
            errorData.status = error.response.status;
            errorData.data = error.response.data;

            if (error.response.status === 401 || error.response.status === 403) {
                this.log('error', 'API key inválida ou revogada', { method });
                this.isHealthy = false;
            }
        } else if (error.request) {
            errorData.network = true;
            errorData.hint = 'Problema de conexão com Moltbook';
        }

        this.logError(method, error);
        return errorData;
    }

    // ═══════════════════════════════════════════════════════════
    // 📊 LOGGING
    // ═══════════════════════════════════════════════════════════

    log(level, message, data = {}) {
        const prefix = { info: '📘', success: '✅', warn: '⚠️', error: '❌' }[level] || '📝';
        console.log(`${prefix} [MOLTBOOK] ${message}`, data);
    }

    logError(method, error) {
        this.log('error', `Erro em ${method}`, {
            message: error.message,
            stack: error.stack?.split('\n')[0],
            response: error.response?.data
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 🔄 CLEANUP
    // ═══════════════════════════════════════════════════════════

    destroy() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
}

const moltbookService = new MoltbookService();

process.on('SIGINT', () => moltbookService.destroy());
process.on('SIGTERM', () => moltbookService.destroy());

module.exports = moltbookService;