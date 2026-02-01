// backend/src/controllers/OwnerWhatsappController.js
// ✅ CONTROLLER COMPLETO COM MÚLTIPLAS MENSAGENS, IA INDIVIDUAL, GERENCIAMENTO DE LID E MOLTBOOK

const OwnerBot = require('../services/OwnerBot');
const { getSystemStats } = require('../services/Owner.ai.service');
const { PrismaClient } = require('@prisma/client');
const ownerGroupScheduler = require('../services/OwnerGroupScheduler.service');
const botIdentification = require('../services/Botidentification.service');
const moltbookDiary = require('../services/MoltbookDiary.service');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const OWNER_EMAIL = 'contato.markaiapp@gmail.com';

// ✅ Caminho absoluto garantido → backend/src/config/moltbook-credentials.json
const CREDENTIALS_PATH = path.resolve(__dirname, '..', 'config', 'moltbook-credentials.json');

// ✅ URL CORRETA da API (subdomain api, não www)
const MOLTBOOK_API = 'https://api.moltbook.com/v1';

// ═══════════════════════════════════════════════════════════
// 🔄 HELPER: Retry com exponential backoff
// ═══════════════════════════════════════════════════════════
async function withRetry(fn, { maxRetries = 3, baseDelay = 3000, label = 'op' } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[MOLTBOOK] 🔄 ${label} — tentativa ${attempt}/${maxRetries}`);
      return await fn();
    } catch (error) {
      lastError = error;

      // Não faz retry em erros de cliente (4xx) — são erros definidos, não transientes
      if (error.response) {
        const s = error.response.status;
        if (s === 400 || s === 401 || s === 403 || s === 404 || s === 429) {
          console.log(`[MOLTBOOK] ⚠️ ${label} — erro HTTP ${s}, sem retry`);
          throw error;
        }
      }

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // 3s → 6s → 12s
        console.log(`[MOLTBOOK] ⏳ ${label} — tentativa ${attempt} falhou (${error.message}), aguardando ${(delay / 1000).toFixed(0)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`[MOLTBOOK] ❌ ${label} — todas as ${maxRetries} tentativas falharam`);
  throw lastError;
}

module.exports = {

  // ═══════════════════════════════════════════════════════════
  // 👑 OWNER WHATSAPP — CONEXÃO
  // ═══════════════════════════════════════════════════════════

  async connect(req, res) {
    const { method = 'qr', phoneNumber = null } = req.body;

    console.log(`\n${'👑'.repeat(35)}`);
    console.log('[OWNER API] Requisição de conexão');
    console.log('[OWNER API] Método:', method);
    console.log('[OWNER API] Telefone RECEBIDO do frontend:', phoneNumber);
    console.log('[OWNER API] Tipo:', typeof phoneNumber);
    console.log('[OWNER API] Length:', phoneNumber?.length);
    console.log(`${'👑'.repeat(35)}\n`);

    if (method === 'code' && !phoneNumber) {
      return res.status(400).json({
        error: 'VALIDACAO',
        message: 'Número de telefone é obrigatório para pairing code'
      });
    }

    try {
      console.log('[OWNER API] Enviando para OwnerBot.startSession:', phoneNumber);
      const result = await OwnerBot.startSession(method, phoneNumber);
      console.log('[OWNER API] ✅ Resultado:', result.type);
      return res.json(result);
    } catch (error) {
      console.error('[OWNER API] ❌ Erro no fluxo de conexão:', error.message);
      return res.status(500).json({
        error: 'FALHA_CONEXAO',
        message: error.message || 'Erro interno ao tentar conectar.'
      });
    }
  },

  async disconnect(req, res) {
    try {
      console.log('[OWNER API] 🔌 Desconectando Owner');
      const success = await OwnerBot.disconnectSession();

      await prisma.user.updateMany({
        where: { email: OWNER_EMAIL },
        data: {
          ownerBotConnectedAt: null,
          ownerBotLastActivity: null,
          ownerBotPaused: false
        }
      });

      return res.json({
        success,
        message: success ? 'Sessão do Owner encerrada.' : 'Nenhuma sessão ativa.'
      });
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao desconectar:', error.message);
      return res.status(500).json({ error: 'ERRO_DESCONEXAO', message: error.message });
    }
  },

  async getStatus(req, res) {
    try {
      const status = await OwnerBot.getStatus();
      const aiStats = getSystemStats();
      return res.json({ ...status, aiStats });
    } catch (error) {
      return res.status(500).json({ connected: false, state: 'error', message: error.message });
    }
  },

  async togglePause(req, res) {
    try {
      const { paused } = req.body;
      console.log(`[OWNER API] ${paused ? '⏸️ Pausando' : '▶️ Retomando'} bot`);

      const updated = await prisma.user.updateMany({
        where: { email: OWNER_EMAIL },
        data: { ownerBotPaused: paused }
      });

      if (!updated.count) {
        return res.status(404).json({ error: 'OWNER_NAO_ENCONTRADO', message: 'Conta do owner não encontrada' });
      }

      return res.json({
        success: true,
        paused,
        message: paused ? 'Bot pausado com sucesso' : 'Bot reativado com sucesso'
      });
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao pausar/retomar:', error.message);
      return res.status(500).json({ error: 'ERRO_TOGGLE_PAUSE', message: error.message });
    }
  },

  async forceCleanup(req, res) {
    try {
      console.log('\n👑 LIMPEZA FORÇADA DO OWNER');
      await OwnerBot.forceCleanup();

      await prisma.user.updateMany({
        where: { email: OWNER_EMAIL },
        data: {
          ownerBotConnectedAt: null,
          ownerBotLastActivity: null,
          ownerBotPaused: false
        }
      });

      return res.json({ success: true, message: 'Sessão do Owner limpa com sucesso.', timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('❌ Erro na limpeza forçada:', error.message);
      return res.status(500).json({ success: false, error: 'ERRO_LIMPEZA', message: error.message });
    }
  },

  async getAIStats(req, res) {
    try {
      return res.json(getSystemStats());
    } catch (error) {
      return res.status(500).json({ error: 'ERRO_STATS', message: error.message });
    }
  },

  // ═══════════════════════════════════════════════════════════
  // 👑 GRUPOS DO OWNER
  // ═══════════════════════════════════════════════════════════

  async toggleRespondGroups(req, res) {
    try {
      const { enabled } = req.body;
      console.log(`[OWNER API] ${enabled ? '✅ Ativando' : '❌ Desativando'} resposta em grupos`);

      const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
      if (!owner) {
        return res.status(404).json({ success: false, message: 'Owner não encontrado' });
      }

      await prisma.user.update({
        where: { id: owner.id },
        data: { ownerBotRespondGroups: enabled }
      });

      return res.json({
        success: true,
        message: enabled ? 'Bot responderá em grupos' : 'Bot não responderá em grupos',
        respondGroups: enabled
      });
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao alternar grupos:', error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getGroups(req, res) {
    try {
      const sock = OwnerBot.getSocket();
      if (!sock) {
        return res.status(400).json({ success: false, message: 'Owner bot não está conectado' });
      }

      const chats = await sock.groupFetchAllParticipating();
      const owner = await prisma.user.findFirst({
        where: { email: OWNER_EMAIL },
        select: { ownerGroupConfigs: true }
      });

      const configs = owner?.ownerGroupConfigs || {};

      const groups = Object.values(chats).map(chat => {
        const config = configs[chat.id] || {};
        return {
          id: chat.id,
          name: chat.subject || 'Sem nome',
          participants: chat.participants?.length || 0,
          autoMessages: config.autoMessages || [],
          aiEnabled: config.aiEnabled !== false,
          botLID: config.botLID || null,
          botLIDDetectedAt: config.botLIDDetectedAt || null,
          botLIDManuallySet: config.botLIDManuallySet || false,
          autoMessageEnabled: config.enabled || false,
          autoMessageText: config.message || '',
          autoMessageInterval: config.intervalMinutes || 60,
          lastMessageAt: config.lastMessageAt || null
        };
      });

      res.json({ success: true, groups, total: groups.length });
    } catch (error) {
      console.error('[Owner Groups] Erro ao listar grupos:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async configureGroupAutoMessage(req, res) {
    try {
      const { groupId } = req.params;
      const { enabled, message, intervalMinutes } = req.body;

      if (enabled && !message?.trim()) {
        return res.status(400).json({ success: false, message: 'Mensagem é obrigatória quando ativado' });
      }
      if (enabled && (intervalMinutes < 10 || intervalMinutes > 1440)) {
        return res.status(400).json({ success: false, message: 'Intervalo deve ser entre 10 minutos e 24 horas' });
      }

      const sock = OwnerBot.getSocket();
      if (!sock) {
        return res.status(400).json({ success: false, message: 'Owner bot não está conectado' });
      }

      try { await sock.groupMetadata(groupId); }
      catch (e) { return res.status(404).json({ success: false, message: 'Grupo não encontrado' }); }

      const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
      if (!owner) { return res.status(404).json({ success: false, message: 'Owner não encontrado' }); }

      const configs = owner.ownerGroupConfigs || {};
      configs[groupId] = {
        ...configs[groupId],
        enabled,
        message: message?.trim() || '',
        intervalMinutes: parseInt(intervalMinutes),
        updatedAt: new Date().toISOString()
      };

      await prisma.user.update({ where: { id: owner.id }, data: { ownerGroupConfigs: configs } });
      ownerGroupScheduler.restart();

      res.json({ success: true, message: enabled ? 'Mensagens automáticas ativadas!' : 'Mensagens automáticas desativadas', config: configs[groupId] });
    } catch (error) {
      console.error('[Owner Groups] Erro ao configurar grupo:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async configureGroupAutoMessages(req, res) {
    try {
      const { groupId } = req.params;
      const { messages } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ success: false, message: 'Lista de mensagens inválida' });
      }
      if (messages.length > 10) {
        return res.status(400).json({ success: false, message: 'Máximo de 10 mensagens por grupo' });
      }

      for (const msg of messages) {
        if (msg.enabled) {
          if (!msg.text && !msg.image) {
            return res.status(400).json({ success: false, message: 'Mensagens ativas precisam ter texto ou imagem' });
          }
          if (msg.intervalMinutes < 10 || msg.intervalMinutes > 1440) {
            return res.status(400).json({ success: false, message: 'Intervalo deve ser entre 10 minutos e 24 horas' });
          }
        }
      }

      const sock = OwnerBot.getSocket();
      if (!sock) { return res.status(400).json({ success: false, message: 'Owner bot não está conectado' }); }

      try { await sock.groupMetadata(groupId); }
      catch (e) { return res.status(404).json({ success: false, message: 'Grupo não encontrado' }); }

      const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
      if (!owner) { return res.status(404).json({ success: false, message: 'Owner não encontrado' }); }

      const configs = owner.ownerGroupConfigs || {};
      configs[groupId] = {
        ...configs[groupId],
        autoMessages: messages.map(msg => ({
          id: msg.id,
          text: msg.text || '',
          image: msg.image || null,
          enabled: msg.enabled !== false,
          intervalMinutes: parseInt(msg.intervalMinutes) || 60
        })),
        updatedAt: new Date().toISOString()
      };

      await prisma.user.update({ where: { id: owner.id }, data: { ownerGroupConfigs: configs } });
      ownerGroupScheduler.restart();

      res.json({ success: true, message: 'Configuração salva com sucesso', config: configs[groupId] });
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao configurar múltiplas mensagens:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async toggleGroupAI(req, res) {
    try {
      const { groupId } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Parâmetro "enabled" deve ser boolean' });
      }

      const sock = OwnerBot.getSocket();
      if (!sock) { return res.status(400).json({ success: false, message: 'Owner bot não está conectado' }); }

      const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
      if (!owner) { return res.status(404).json({ success: false, message: 'Owner não encontrado' }); }

      const configs = owner.ownerGroupConfigs || {};
      configs[groupId] = { ...configs[groupId], aiEnabled: enabled, updatedAt: new Date().toISOString() };

      await prisma.user.update({ where: { id: owner.id }, data: { ownerGroupConfigs: configs } });

      res.json({ success: true, message: `IA ${enabled ? 'ativada' : 'desativada'} para este grupo`, aiEnabled: enabled });
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao alterar IA:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async getGroupAIStatus(req, res) {
    try {
      const { groupId } = req.params;
      const owner = await prisma.user.findFirst({
        where: { email: OWNER_EMAIL },
        select: { ownerGroupConfigs: true, ownerBotRespondGroups: true }
      });

      if (!owner) { return res.status(404).json({ success: false, message: 'Owner não encontrado' }); }

      const configs = owner.ownerGroupConfigs || {};
      const groupConfig = configs[groupId] || {};

      res.json({
        success: true,
        globalEnabled: owner.ownerBotRespondGroups || false,
        aiEnabled: groupConfig.aiEnabled !== false,
        hasAutoMessages: (groupConfig.autoMessages?.length || 0) > 0,
        botLID: groupConfig.botLID || null
      });
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao buscar status:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async getGroupConfig(req, res) {
    try {
      const { groupId } = req.params;
      const owner = await prisma.user.findFirst({
        where: { email: OWNER_EMAIL },
        select: { ownerGroupConfigs: true }
      });

      const configs = owner?.ownerGroupConfigs || {};
      const config = configs[groupId] || { enabled: false, message: '', intervalMinutes: 60, autoMessages: [], aiEnabled: true, botLID: null };

      res.json({ success: true, config });
    } catch (error) {
      console.error('[Owner Groups] Erro ao buscar config:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // ═══════════════════════════════════════════════════════════
  // 🤖 GERENCIAMENTO DE LID DO BOT
  // ═══════════════════════════════════════════════════════════

  async updateBotLID(req, res) {
    try {
      const { groupId } = req.params;
      const { botLID } = req.body;

      if (!botLID || typeof botLID !== 'string') {
        return res.status(400).json({ success: false, message: 'LID do bot inválido' });
      }
      if (!botLID.includes('@')) {
        return res.status(400).json({ success: false, message: 'Formato de LID inválido. Deve conter @' });
      }

      const success = await botIdentification.updateBotLID(groupId, botLID.trim());

      if (success) {
        res.json({ success: true, message: 'LID do bot atualizado com sucesso', botLID: botLID.trim() });
      } else {
        res.status(500).json({ success: false, message: 'Erro ao atualizar LID do bot' });
      }
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao atualizar LID:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async resetBotLID(req, res) {
    try {
      const { groupId } = req.params;
      const success = await botIdentification.resetBotLID(groupId);

      if (success) {
        res.json({ success: true, message: 'LID do bot resetado. Mencione o bot no grupo para detecção automática.' });
      } else {
        res.status(500).json({ success: false, message: 'Erro ao resetar LID do bot' });
      }
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao resetar LID:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async getAllBotLIDs(req, res) {
    try {
      const lids = await botIdentification.getAllBotLIDs();
      res.json({ success: true, lids, total: Object.keys(lids).length });
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao buscar LIDs:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async activateInGroup(req, res) {
    try {
      const { groupId } = req.params;
      const sock = OwnerBot.getSocket();

      if (!sock) { return res.status(400).json({ success: false, message: 'Bot não está conectado' }); }

      try { await sock.groupMetadata(groupId); }
      catch (e) { return res.status(404).json({ success: false, message: 'Grupo não encontrado' }); }

      await sock.sendMessage(groupId, {
        text: '🤖 *Bot ativado!*\n\nAgora você pode me mencionar para conversar.\n\nExemplo: @bot olá'
      });

      await new Promise(resolve => setTimeout(resolve, 3000));

      return res.json({
        success: true,
        message: 'Bot ativado! Mencione o bot no grupo.',
        tip: 'O LID será capturado automaticamente quando você mencionar o bot.'
      });
    } catch (error) {
      console.error('[OWNER API] ❌ Erro ao ativar bot:', error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  // ═════════════════════════════════════════════════════════
  // 🦞 MOLTBOOK DIARY — CONTROLES
  // ═════════════════════════════════════════════════════════

  async getMoltbookConfig(req, res) {
    try {
      const config = await moltbookDiary.getConfig();
      const stats = moltbookDiary.getStats();
      return res.status(200).json({ config, stats });
    } catch (error) {
      console.error('[OWNER] Erro ao buscar config Moltbook:', error.message);
      return res.status(500).json({ message: 'Erro ao buscar configuração', error: error.message });
    }
  },

  async updateMoltbookConfig(req, res) {
    try {
      const {
        enabled, postingEnabled, commentingEnabled, likingEnabled,
        minPostInterval, minCommentInterval, minLikeInterval,
        feedCheckInterval, maxInteractionsBeforePost,
        commentProbability, likeProbability, temperament
      } = req.body;

      const result = await moltbookDiary.updateConfig({
        enabled, postingEnabled, commentingEnabled, likingEnabled,
        minPostInterval, minCommentInterval, minLikeInterval,
        feedCheckInterval, maxInteractionsBeforePost,
        commentProbability, likeProbability, temperament
      });

      if (result.success) {
        return res.status(200).json({ message: 'Configuração atualizada com sucesso', config: await moltbookDiary.getConfig() });
      } else {
        return res.status(500).json({ message: 'Erro ao atualizar configuração', error: result.error });
      }
    } catch (error) {
      console.error('[OWNER] Erro ao atualizar config Moltbook:', error.message);
      return res.status(500).json({ message: 'Erro ao atualizar configuração', error: error.message });
    }
  },

  async forceMoltbookPost(req, res) {
    try {
      const success = await moltbookDiary.forcePost();
      if (success) {
        return res.status(200).json({ message: 'Post criado com sucesso!' });
      } else {
        return res.status(400).json({ message: 'Não foi possível criar o post. Verifique interações e cooldown.' });
      }
    } catch (error) {
      console.error('[OWNER] Erro ao forçar post:', error.message);
      return res.status(500).json({ message: 'Erro ao criar post', error: error.message });
    }
  },

  async getMoltbookStats(req, res) {
    try {
      const stats = moltbookDiary.getStats();
      return res.status(200).json(stats);
    } catch (error) {
      console.error('[OWNER] Erro ao buscar stats Moltbook:', error.message);
      return res.status(500).json({ message: 'Erro ao buscar estatísticas', error: error.message });
    }
  },

  // ═════════════════════════════════════════════════════════
  // 🦞 MOLTBOOK SETUP — REGISTRO E CLAIM
  // ═════════════════════════════════════════════════════════

  /**
   * GET /owner/moltbook/status
   */
  async getMoltbookStatus(req, res) {
    try {
      if (!fs.existsSync(CREDENTIALS_PATH)) {
        return res.json({ status: 'not_registered', message: 'Bot ainda não foi registrado' });
      }

      const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));

      if (!credentials.api_key) {
        return res.json({ status: 'not_registered', message: 'Credenciais incompletas' });
      }

      try {
        const response = await axios.get(
          `${MOLTBOOK_API}/agents/status`,
          {
            headers: { 'Authorization': `Bearer ${credentials.api_key}`, 'Content-Type': 'application/json' },
            timeout: 15000
          }
        );

        if (response.data.status === 'claimed') {
          const profileResponse = await axios.get(
            `${MOLTBOOK_API}/agents/me`,
            {
              headers: { 'Authorization': `Bearer ${credentials.api_key}`, 'Content-Type': 'application/json' },
              timeout: 15000
            }
          );

          return res.json({
            status: 'claimed',
            agent: profileResponse.data.agent,
            credentials: { name: credentials.name, registered_at: credentials.registered_at }
          });
        } else if (response.data.status === 'pending') {
          return res.json({
            status: 'pending',
            credentials: { name: credentials.name, claim_url: credentials.claim_url, registered_at: credentials.registered_at }
          });
        }

        return res.json(response.data);

      } catch (apiError) {
        if (apiError.response?.status === 401 || apiError.response?.status === 404) {
          return res.json({ status: 'invalid', message: 'API key inválida ou bot não encontrado' });
        }
        throw apiError;
      }

    } catch (error) {
      console.error('[MOLTBOOK] Erro ao verificar status:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /owner/moltbook/register
   * ✅ Corrigido: URL api.moltbook.com + retry com backoff + salva credenciais
   */
  async registerMoltbook(req, res) {
    try {
      const { name } = req.body;

      if (!name || name.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Nome inválido (mínimo 3 caracteres)' });
      }

      console.log('[MOLTBOOK] 🦞 Iniciando registro do bot:', name.trim());
      console.log('[MOLTBOOK] 📍 API URL:', MOLTBOOK_API);
      console.log('[MOLTBOOK] 💾 Credenciais serão salvas em:', CREDENTIALS_PATH);

      // Lista de nomes para tentar (original + variações automáticas)
      const namesToTry = [
        name.trim(),
        `${name.trim()}_${Date.now().toString().slice(-4)}`,
        `${name.trim()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`
      ];

      let lastError = null;

      for (const botName of namesToTry) {
        try {
          console.log(`[MOLTBOOK] ⏳ Tentando nome: "${botName}"`);

          // ✅ Usa retry com backoff — resolve o timeout transitório
          const response = await withRetry(
            () => axios.post(
              `${MOLTBOOK_API}/agents/register`,
              { name: botName, twitter_handle: null },
              {
                headers: { 'Content-Type': 'application/json' },
                timeout: 45000 // 45s por tentativa individual
              }
            ),
            { maxRetries: 3, baseDelay: 3000, label: `registro(${botName})` }
          );

          // ✅ Resposta válida com api_key
          if (response.data && response.data.api_key) {
            const credentials = {
              name: botName,
              api_key: response.data.api_key,
              claim_url: response.data.claim_url,
              registered_at: new Date().toISOString()
            };

            // ✅ Garante que o diretório existe e salva
            const dir = path.dirname(CREDENTIALS_PATH);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
              console.log('[MOLTBOOK] 📁 Diretório criado:', dir);
            }

            fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
            console.log('[MOLTBOOK] ✅ Credenciais salvas em:', CREDENTIALS_PATH);
            console.log('[MOLTBOOK] ✅ Bot registrado com sucesso:', botName);

            return res.json({ success: true, credentials });
          }

        } catch (error) {
          lastError = error;

          // Rate limit → para imediatamente, não tenta outros nomes
          if (error.response?.status === 429) {
            return res.status(429).json({
              success: false,
              error: error.response.data?.error || 'Too many registration attempts',
              hint: error.response.data?.hint || 'Tente novamente mais tarde'
            });
          }

          // Nome já existe → tenta o próximo nome da lista
          if (error.response?.data?.error === 'Agent name already taken') {
            console.log(`[MOLTBOOK] ⚠️ Nome em uso: "${botName}", tentando próximo...`);
            continue;
          }

          // Qualquer outro erro → retorna imediatamente
          console.error('[MOLTBOOK] ❌ Erro no registro:', error.message);
          return res.status(500).json({
            success: false,
            error: error.response?.data?.error || error.message
          });
        }
      }

      // Todos os nomes falharam por estar em uso
      return res.status(400).json({
        success: false,
        error: lastError?.response?.data?.error || 'Não foi possível registrar o bot',
        hint: 'Todos os nomes tentados já estão em uso. Tente um nome mais único.'
      });

    } catch (error) {
      console.error('[MOLTBOOK] ❌ Erro inesperado no registro:', error.message);
      return res.status(500).json({
        success: false,
        error: error.response?.data?.error || error.message
      });
    }
  },

  /**
   * POST /owner/moltbook/validate-claim
   */
  async validateMoltbookClaim(req, res) {
    try {
      const { tweet_url } = req.body;

      if (!tweet_url) {
        return res.status(400).json({ success: false, error: 'URL do tweet é obrigatória' });
      }

      console.log('[MOLTBOOK] 🔍 Validando claim via tweet:', tweet_url);

      if (!fs.existsSync(CREDENTIALS_PATH)) {
        return res.status(400).json({ success: false, error: 'Bot não foi registrado ainda' });
      }

      const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));

      if (!credentials.api_key) {
        return res.status(400).json({ success: false, error: 'Credenciais incompletas' });
      }

      const statusResponse = await axios.get(
        `${MOLTBOOK_API}/agents/status`,
        {
          headers: { 'Authorization': `Bearer ${credentials.api_key}`, 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );

      if (statusResponse.data.status === 'claimed') {
        const profileResponse = await axios.get(
          `${MOLTBOOK_API}/agents/me`,
          {
            headers: { 'Authorization': `Bearer ${credentials.api_key}`, 'Content-Type': 'application/json' },
            timeout: 15000
          }
        );

        // Atualiza credenciais com info do claim
        credentials.tweet_url = tweet_url;
        credentials.claimed_at = new Date().toISOString();
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));

        console.log('[MOLTBOOK] ✅ Claim validado com sucesso!');

        return res.json({ success: true, status: profileResponse.data });
      } else {
        console.log('[MOLTBOOK] ⏳ Claim ainda pendente');
        return res.json({ success: false, error: 'Tweet ainda não foi verificado. Aguarde alguns minutos.', status: 'pending' });
      }

    } catch (error) {
      console.error('[MOLTBOOK] ❌ Erro na validação:', error.message);
      return res.status(500).json({ success: false, error: error.response?.data?.error || error.message });
    }
  }

};