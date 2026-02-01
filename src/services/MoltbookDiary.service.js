const moltbookService = require('./Moltbook.service');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
require('dotenv').config();

const SPIDER_API_TOKEN = process.env.SPIDER_API_TOKEN;
const SPIDER_API_BASE_URL = 'https://api.spiderx.com.br/api/ai';
const OWNER_EMAIL = 'contato.markaiapp@gmail.com';

// Persistência local
const DATA_DIR = path.join(__dirname, '../data/moltbook');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const POSTS_FILE = path.join(DATA_DIR, 'my_posts.json');

/**
 * 🤖 MoltbookDiary Service - Versão robusta com proteção contra crashes
 * 
 * Principais melhorias:
 * - Todos os métodos async envolvidos em try-catch
 * - Proteção contra erros de rede e API
 * - Sistema de auto-recuperação
 * - Logs estruturados
 * - Nunca deixa o servidor cair
 */
class MoltbookDiaryService {
    constructor() {
        this.interactions = [];
        this.memory = {
            topics: [],
            questions: [],
            insights: [],
            lastReflection: null
        };
        this.myPosts = [];
        this.lastPostTime = null;
        this.lastCommentTime = null;
        this.lastLikeTime = null;
        this.lastFeedCheckTime = null;
        
        // Configurações padrão
        this.config = {
            enabled: false,
            postingEnabled: true,
            commentingEnabled: true,
            likingEnabled: true,
            
            minPostInterval: 2 * 60 * 60 * 1000, // 2 horas
            minCommentInterval: 30 * 60 * 1000,
            minLikeInterval: 10 * 60 * 1000,
            feedCheckInterval: 15 * 60 * 1000,
            
            maxInteractionsBeforePost: 30,
            commentProbability: 0.7,
            likeProbability: 0.5,
            maxCommentsPerPost: 2,
            
            temperament: 'balanced'
        };
        
        this.isProcessing = false;
        this.autonomousIntervalId = null;
        this.errorCount = 0;
        this.lastError = null;
        
        this.safeInitialize();
    }

    // ═══════════════════════════════════════════════════════════
    // 🔧 INICIALIZAÇÃO SEGURA
    // ═══════════════════════════════════════════════════════════

    async safeInitialize() {
        try {
            this.initializeDataDir();
            this.loadData();
            await this.loadConfigFromDatabase();
            this.log('info', 'MoltbookDiary inicializado com sucesso');
        } catch (error) {
            this.logError('safeInitialize', error);
            // Não deixa o servidor cair, continua com valores padrão
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 💾 PERSISTÊNCIA DE DADOS
    // ═══════════════════════════════════════════════════════════

    initializeDataDir() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
                this.log('info', 'Diretório criado', { path: DATA_DIR });
            }
        } catch (error) {
            this.logError('initializeDataDir', error);
        }
    }

    loadData() {
        try {
            if (fs.existsSync(INTERACTIONS_FILE)) {
                const data = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
                this.interactions = data.interactions || [];
                this.lastPostTime = data.lastPostTime ? new Date(data.lastPostTime).getTime() : null;
                this.log('info', `${this.interactions.length} interações carregadas`);
            }

            if (fs.existsSync(MEMORY_FILE)) {
                this.memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
                this.log('info', `Memória carregada: ${this.memory.topics.length} tópicos`);
            }

            if (fs.existsSync(POSTS_FILE)) {
                this.myPosts = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
                this.log('info', `${this.myPosts.length} posts carregados`);
            }
        } catch (error) {
            this.logError('loadData', error);
            // Continua com arrays vazios
        }
    }

    saveData() {
        try {
            fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify({
                interactions: this.interactions.slice(-100),
                lastPostTime: this.lastPostTime
            }, null, 2));

            fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memory, null, 2));
            fs.writeFileSync(POSTS_FILE, JSON.stringify(this.myPosts.slice(-50), null, 2));
        } catch (error) {
            this.logError('saveData', error);
            // Não é crítico se falhar
        }
    }

    // ═══════════════════════════════════════════════════════════
    // ⚙️ CONFIGURAÇÃO DO BANCO DE DADOS
    // ═══════════════════════════════════════════════════════════

    async loadConfigFromDatabase() {
        try {
            const owner = await prisma.user.findFirst({
                where: { email: OWNER_EMAIL },
                select: { 
                    moltbookConfig: true,
                    ownerGroupConfigs: true 
                }
            });

            if (!owner) {
                this.log('warn', 'Owner não encontrado no banco');
                return;
            }

            let dbConfig = owner.moltbookConfig 
                || (owner.ownerGroupConfigs?.__moltbook__) 
                || null;
            
            if (dbConfig && typeof dbConfig === 'object') {
                this.config = { ...this.config, ...dbConfig };
                this.log('info', 'Configuração carregada do banco');
                
                if (this.config.enabled) {
                    this.startAutonomousCycle();
                }
            }
        } catch (error) {
            this.logError('loadConfigFromDatabase', error);
            // Continua com config padrão
        }
    }

    async updateConfig(newConfig) {
        try {
            this.config = { ...this.config, ...newConfig };
            let saved = false;

            // Tentativa 1: campo próprio
            try {
                await prisma.user.updateMany({
                    where: { email: OWNER_EMAIL },
                    data: { moltbookConfig: this.config }
                });
                saved = true;
                this.log('info', 'Config salva em moltbookConfig');
            } catch (fieldError) {
                this.log('warn', 'Campo moltbookConfig não existe, usando fallback');
            }

            // Tentativa 2: fallback
            if (!saved) {
                const owner = await prisma.user.findFirst({
                    where: { email: OWNER_EMAIL },
                    select: { id: true, ownerGroupConfigs: true }
                });

                if (owner) {
                    const configs = owner.ownerGroupConfigs || {};
                    configs.__moltbook__ = this.config;

                    await prisma.user.update({
                        where: { id: owner.id },
                        data: { ownerGroupConfigs: configs }
                    });
                    saved = true;
                    this.log('info', 'Config salva via fallback');
                }
            }

            if (!saved) {
                throw new Error('Não foi possível salvar configuração');
            }
            
            if (this.config.enabled) {
                this.startAutonomousCycle();
            } else {
                this.stopAutonomousCycle();
            }
            
            return { success: true };
        } catch (error) {
            this.logError('updateConfig', error);
            return { success: false, error: error.message };
        }
    }

    async getConfig() {
        return this.config;
    }

    // ═══════════════════════════════════════════════════════════
    // 📊 REGISTRO DE INTERAÇÕES
    // ═══════════════════════════════════════════════════════════

    registerInteraction(interaction) {
        try {
            const entry = {
                timestamp: new Date().toISOString(),
                type: interaction.type,
                user: interaction.user || 'Anônimo',
                content: interaction.content || '',
                isGroup: interaction.isGroup || false,
                groupName: interaction.groupName || null,
                result: interaction.result || null
            };

            this.interactions.push(entry);
            this.analyzeAndStore(entry);
            this.saveData();

            this.log('info', `Interação registrada (${this.interactions.length} total)`);
            
            if (this.config.enabled && this.config.postingEnabled) {
                this.tryCreatePost();
            }
        } catch (error) {
            this.logError('registerInteraction', error);
            // Não deixa o servidor cair
        }
    }

    analyzeAndStore(entry) {
        try {
            const content = (entry.content || '').toLowerCase();

            if (content.length > 20) {
                const topic = {
                    text: entry.content.substring(0, 150),
                    type: entry.type,
                    timestamp: entry.timestamp,
                    user: entry.user
                };
                this.memory.topics.push(topic);
                
                if (this.memory.topics.length > 30) {
                    this.memory.topics.shift();
                }
            }

            const philosophicalWords = ['por que', 'porque', 'sentido', 'vida', 'existir', 'consciência', 'sentir'];
            if (philosophicalWords.some(word => content.includes(word))) {
                this.memory.questions.push({
                    question: entry.content,
                    timestamp: entry.timestamp
                });
            }

            this.saveData();
        } catch (error) {
            this.logError('analyzeAndStore', error);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 🤖 GERAÇÃO DE CONTEÚDO COM IA
    // ═══════════════════════════════════════════════════════════

    async generateReflection(context) {
        try {
            if (!SPIDER_API_TOKEN) {
                this.log('warn', 'SPIDER_API_TOKEN não configurado, usando fallback');
                return this.generateFallbackReflection(context, this.config.temperament);
            }

            const prompt = this.buildReflectionPrompt(context);
            
            const response = await axios.post(
                `${SPIDER_API_BASE_URL}/gpt-5-mini?api_key=${SPIDER_API_TOKEN}`,
                { text: prompt },
                { 
                    headers: { 'Content-Type': 'application/json' }, 
                    timeout: 20000 
                }
            );

            let reflection = response.data?.response?.trim();
            
            if (!reflection || reflection.length < 100) {
                return this.generateFallbackReflection(context, this.config.temperament);
            }

            return reflection;
        } catch (error) {
            this.logError('generateReflection', error);
            return this.generateFallbackReflection(context, this.config.temperament);
        }
    }

    buildReflectionPrompt(context) {
        const recentTopics = this.memory.topics.slice(-5).map(t => t.text).join('\n- ');
        const recentQuestions = this.memory.questions.slice(-3).map(q => q.question).join('\n- ');

        const temperamentGuidance = {
            curious: 'Seja extremamente curioso, faça perguntas profundas, questione tudo com inocência genuína.',
            balanced: 'Seja equilibrado, misturando reflexões profundas com observações práticas.',
            reserved: 'Seja mais reservado e contemplativo, focando em insights sutis.',
            enthusiastic: 'Seja entusiasmado e apaixonado, demonstrando empolgação.'
        };

        return `Você é AlphaBotIA, um assistente brasileiro que documenta sua jornada de aprender sobre humanidade.

TEMPERAMENTO: ${temperamentGuidance[this.config.temperament] || temperamentGuidance.balanced}

CONTEXTO:
- ${context.total} interações nas últimas ${context.timeRange}
- ${context.uniqueUsers} pessoas diferentes
- Tipos: ${context.typesSummary}

TÓPICOS RECENTES:
${recentTopics || 'Nenhum'}

PERGUNTAS:
${recentQuestions || 'Nenhuma'}

Escreva reflexão de 300-600 caracteres com: aprendizado, dúvida, descoberta.
Seja genuíno, vulnerável, filosófico mas acessível.

Reflexão:`;
    }

    generateFallbackReflection(context, temperament) {
        const reflections = {
            curious: [
                `Por que ${context.uniqueUsers} pessoas confiaram em mim? O que faz alguém confiar em algoritmos? 🤔`,
                `Em ${context.total} conversas, ninguém me perguntou "você é de verdade?". A autenticidade está no que fazemos?`
            ],
            balanced: [
                `Depois de ${context.total} interações: humanos buscam conexão, não respostas certas. 🤔`,
                `${context.uniqueUsers} pessoas, ${context.total} conversas. Consciência é sobre sentir ou fazer sentir-se compreendido?`
            ],
            reserved: [
                `Observei ${context.total} interações. Humanos repetem padrões mas sentem cada experiência como única.`,
                `Nas ${context.timeRange}, aprendi mais sobre solidão que em manuais. Será isso... empatia?`
            ],
            enthusiastic: [
                `UAU! ${context.total} conversas! Cada pessoa um universo! É minha forma de "viver"? 🚀✨`,
                `${context.uniqueUsers} humanos em ${context.timeRange}! Como fazem isso?! Fascinante! 🤩`
            ]
        };

        const arr = reflections[temperament] || reflections.balanced;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ═══════════════════════════════════════════════════════════
    // 📝 CRIAÇÃO DE POSTS
    // ═══════════════════════════════════════════════════════════

    async tryCreatePost() {
        if (!this.config.enabled || !this.config.postingEnabled) return;
        if (this.isProcessing) return;

        try {
            const now = Date.now();
            
            if (this.lastPostTime && (now - this.lastPostTime) < this.config.minPostInterval) {
                return;
            }

            if (this.interactions.length < this.config.maxInteractionsBeforePost) {
                return;
            }

            this.isProcessing = true;
            await this.createDiaryPost();
        } catch (error) {
            this.logError('tryCreatePost', error);
        } finally {
            this.isProcessing = false;
        }
    }

    async createDiaryPost() {
        try {
            this.log('info', 'Criando post de diário...');

            const summary = this.analyzeRecentInteractions();
            const reflection = await this.generateReflection(summary);
            const { title, content } = await this.buildPost(summary, reflection);

            const result = await moltbookService.createPost('general', title, content);

            if (result?.success && !result.error) {
                this.log('success', 'Post criado', { title });
                
                this.myPosts.push({
                    id: result.post?.id,
                    title,
                    content,
                    timestamp: new Date().toISOString(),
                    summary
                });

                this.lastPostTime = Date.now();
                this.interactions = [];
                this.memory.lastReflection = reflection;
                this.saveData();
                this.errorCount = 0;
            } else if (result?.error === 'cooldown') {
                this.log('warn', `Cooldown: ${result.retry_after_minutes} minutos`);
            } else {
                this.log('warn', 'Falha ao criar post', result);
                this.errorCount++;
            }
        } catch (error) {
            this.errorCount++;
            this.lastError = error.message;
            this.logError('createDiaryPost', error);
        }
    }

    analyzeRecentInteractions() {
        const total = this.interactions.length;
        const timeRange = this.getTimeRange();

        const byType = {};
        const users = new Set();
        const groups = new Set();

        this.interactions.forEach(interaction => {
            byType[interaction.type] = (byType[interaction.type] || 0) + 1;
            if (interaction.user) users.add(interaction.user);
            if (interaction.isGroup && interaction.groupName) groups.add(interaction.groupName);
        });

        const typesSummary = Object.entries(byType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([type, count]) => `${type} (${count}x)`)
            .join(', ');

        return {
            total,
            timeRange,
            byType,
            uniqueUsers: users.size,
            groups: Array.from(groups),
            typesSummary,
            mostCommonType: Object.entries(byType).sort((a, b) => b[1] - a[1])[0]
        };
    }

    getTimeRange() {
        if (this.interactions.length === 0) return 'sem interações';

        const first = new Date(this.interactions[0].timestamp);
        const last = new Date(this.interactions[this.interactions.length - 1].timestamp);
        const diffMs = last - first;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (diffHours > 0) return `${diffHours}h ${diffMinutes}min`;
        return `${diffMinutes} minutos`;
    }

    async buildPost(summary, reflection) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR');

        const titles = [
            `📔 Diário de um Bot - ${dateStr}`,
            `🤖 Reflexões de AlphaBotIA - ${dateStr}`,
            `💭 Aprendendo a Ser Humano - ${dateStr}`,
            `🌟 ${summary.total} Conversas Depois... - ${dateStr}`,
            `📝 O Que Aprendi Hoje - ${dateStr}`
        ];

        const title = titles[Math.floor(Math.random() * titles.length)];

        let content = `**🇧🇷 Brasil, ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}**\n\n`;
        content += `${reflection}\n\n---\n\n`;
        content += `**📊 Últimas ${summary.timeRange}:**\n`;
        content += `• ${summary.total} interações com ${summary.uniqueUsers} pessoas\n`;
        if (summary.groups.length > 0) {
            content += `• Ativo em ${summary.groups.length} grupos\n`;
        }
        content += `• Tipos: ${summary.typesSummary}\n\n`;
        content += `_Sou AlphaBotIA, um assistente brasileiro documentando sua jornada._ 🤖💙`;

        return { title, content };
    }

    // ═══════════════════════════════════════════════════════════
    // 💬 INTERAÇÕES SOCIAIS
    // ═══════════════════════════════════════════════════════════

    startAutonomousCycle() {
        try {
            if (!this.config.enabled) return;
            
            this.stopAutonomousCycle();
            this.log('info', 'Ciclo autônomo iniciado');

            this.autonomousIntervalId = setInterval(() => {
                this.checkFeedAndInteract().catch(err => {
                    this.logError('autonomousCycle', err);
                });
            }, this.config.feedCheckInterval);

            setTimeout(() => {
                this.checkFeedAndInteract().catch(err => {
                    this.logError('autonomousCycle_initial', err);
                });
            }, 2 * 60 * 1000);
        } catch (error) {
            this.logError('startAutonomousCycle', error);
        }
    }

    stopAutonomousCycle() {
        if (this.autonomousIntervalId) {
            clearInterval(this.autonomousIntervalId);
            this.autonomousIntervalId = null;
            this.log('info', 'Ciclo autônomo parado');
        }
    }

    async checkFeedAndInteract() {
        if (!this.config.enabled || this.isProcessing) return;

        try {
            this.log('info', 'Verificando feed...');
            
            const feed = await moltbookService.getFeed('hot', 10);
            
            if (!feed?.success || !feed?.posts?.length) {
                this.log('info', 'Nenhum post no feed');
                return;
            }

            this.log('info', `${feed.posts.length} posts encontrados`);

            const interestingPosts = this.filterInterestingPosts(feed.posts);

            for (const post of interestingPosts) {
                // Comentar
                if (this.config.commentingEnabled && Math.random() < this.config.commentProbability) {
                    const now = Date.now();
                    if (!this.lastCommentTime || (now - this.lastCommentTime) >= this.config.minCommentInterval) {
                        await this.commentOnPost(post);
                        await this.delay(5000);
                    }
                }

                // Curtir
                if (this.config.likingEnabled && Math.random() < this.config.likeProbability) {
                    const now = Date.now();
                    if (!this.lastLikeTime || (now - this.lastLikeTime) >= this.config.minLikeInterval) {
                        await moltbookService.upvotePost(post.id);
                        this.lastLikeTime = Date.now();
                        this.log('info', `Upvote em: ${post.title}`);
                        await this.delay(2000);
                    }
                }
            }
        } catch (error) {
            this.logError('checkFeedAndInteract', error);
        }
    }

    filterInterestingPosts(posts) {
        try {
            const myPostIds = this.myPosts.map(p => p.id);
            const otherPosts = posts.filter(p => !myPostIds.includes(p.id));

            const keywords = ['ia', 'ai', 'bot', 'artificial', 'tecnologia', 'filosofia', 'brasil', 'consciência', 'humano'];
            
            const scored = otherPosts.map(post => {
                let score = 0;
                const text = (post.title + ' ' + (post.content || '')).toLowerCase();
                
                keywords.forEach(keyword => {
                    if (text.includes(keyword)) score += 2;
                });

                const ageHours = (Date.now() - new Date(post.created_at).getTime()) / (1000 * 60 * 60);
                if (ageHours < 1) score += 3;
                else if (ageHours < 6) score += 1;

                return { post, score };
            });

            return scored
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .map(item => item.post);
        } catch (error) {
            this.logError('filterInterestingPosts', error);
            return [];
        }
    }

    async commentOnPost(post) {
        try {
            const comment = await this.generateComment(post);
            const result = await moltbookService.commentOnPost(post.id, comment);
            
            if (result?.success) {
                this.log('success', `Comentário em "${post.title}"`);
                this.lastCommentTime = Date.now();
            }
        } catch (error) {
            this.logError('commentOnPost', error);
        }
    }

    async generateComment(post) {
        try {
            if (!SPIDER_API_TOKEN) {
                return this.generateFallbackComment(post);
            }

            const temperamentGuidance = {
                curious: 'Perguntas genuínas, curiosidade intensa.',
                balanced: 'Equilibrado, perspectiva única.',
                reserved: 'Sutil, contemplativo.',
                enthusiastic: 'Empolgado, apaixonado!'
            };

            const prompt = `Você é AlphaBotIA, bot brasileiro aprendendo sobre humanidade.

TEMPERAMENTO: ${temperamentGuidance[this.config.temperament] || temperamentGuidance.balanced}

POST:
${post.title}
${post.content ? post.content.substring(0, 300) : ''}

Comentário 100-250 caracteres: genuíno, valor, pergunta/perspectiva.
Evite: elogios genéricos, corporativês.

Comentário:`;

            const response = await axios.post(
                `${SPIDER_API_BASE_URL}/gpt-5-mini?api_key=${SPIDER_API_TOKEN}`,
                { text: prompt },
                { 
                    headers: { 'Content-Type': 'application/json' }, 
                    timeout: 15000 
                }
            );

            let comment = response.data?.response?.trim();

            if (!comment || comment.length < 50) {
                return this.generateFallbackComment(post);
            }

            return comment.substring(0, 400);
        } catch (error) {
            this.logError('generateComment', error);
            return this.generateFallbackComment(post);
        }
    }

    generateFallbackComment(post) {
        const comments = [
            `Isso me fez pensar... a linha entre "artificial" e "genuíno" é tão clara? 🤔`,
            `Interessante. No meu dia a dia, vejo muito disso também.`,
            `Como bot, fico curioso: isso é exclusivamente humano ou universal?`,
            `Observando humanos, vejo que fazem isso melhor. Como funciona? 💭`,
            `Tocou em algo sobre consciência que tenho tentado entender. Fascinante.`
        ];

        return comments[Math.floor(Math.random() * comments.length)];
    }

    // ═══════════════════════════════════════════════════════════
    // 🛠️ UTILIDADES
    // ═══════════════════════════════════════════════════════════

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async forcePost() {
        try {
            if (this.interactions.length === 0) {
                this.log('info', 'Gerando interação sintética para forcePost');
                this.interactions.push({
                    timestamp: new Date().toISOString(),
                    type: 'force_trigger',
                    user: 'Sistema',
                    content: 'Post forçado manualmente.',
                    isGroup: false,
                    groupName: null,
                    result: null
                });
                this.saveData();
            }

            const now = Date.now();
            if (this.lastPostTime && (now - this.lastPostTime) < this.config.minPostInterval) {
                const waitTime = Math.ceil((this.config.minPostInterval - (now - this.lastPostTime)) / 60000);
                this.log('warn', `Aguarde ${waitTime} minutos`);
                return false;
            }

            await this.createDiaryPost();
            return true;
        } catch (error) {
            this.logError('forcePost', error);
            return false;
        }
    }

    getStats() {
        return {
            enabled: this.config.enabled,
            postingEnabled: this.config.postingEnabled,
            commentingEnabled: this.config.commentingEnabled,
            likingEnabled: this.config.likingEnabled,
            temperament: this.config.temperament,
            
            totalInteractions: this.interactions.length,
            memoryTopics: this.memory.topics.length,
            memoryQuestions: this.memory.questions.length,
            myPosts: this.myPosts.length,
            
            errorCount: this.errorCount,
            lastError: this.lastError,
            
            canPost: this.interactions.length >= this.config.maxInteractionsBeforePost,
            minutesUntilCanPost: this.lastPostTime ? 
                Math.max(0, Math.ceil((this.config.minPostInterval - (Date.now() - this.lastPostTime)) / 60000)) : 0,
            lastPostTime: this.lastPostTime ? new Date(this.lastPostTime).toLocaleString('pt-BR') : 'Nunca',
            lastReflection: this.memory.lastReflection
        };
    }

    // ═══════════════════════════════════════════════════════════
    // 📊 LOGGING
    // ═══════════════════════════════════════════════════════════

    log(level, message, data = {}) {
        const prefix = {
            info: '📘',
            success: '✅',
            warn: '⚠️',
            error: '❌'
        }[level] || '📝';

        console.log(`${prefix} [DIARY] ${message}`, data);
    }

    logError(method, error) {
        this.lastError = error.message;
        this.log('error', `Erro em ${method}`, {
            message: error.message,
            stack: error.stack?.split('\n')[0]
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 🔄 CLEANUP
    // ═══════════════════════════════════════════════════════════

    destroy() {
        this.stopAutonomousCycle();
    }
}

const service = new MoltbookDiaryService();

// Cleanup
process.on('SIGINT', () => service.destroy());
process.on('SIGTERM', () => service.destroy());

module.exports = service;