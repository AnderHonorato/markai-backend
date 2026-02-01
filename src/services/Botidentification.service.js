// backend/src/services/Botidentification.service.js
// ✅ VERSÃO SIMPLIFICADA - USA NÚMERO REAL DO BOT

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const OWNER_EMAIL = 'contato.markaiapp@gmail.com';

async function detectAndSaveBotLID(groupId, mentionedJids, sock) {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL },
            select: { ownerGroupConfigs: true }
        });

        const configs = owner?.ownerGroupConfigs || {};
        const groupConfig = configs[groupId] || {};
        
        if (groupConfig.botLID) {
            return groupConfig.botLID;
        }
        
        console.log('[BOT ID] ⚠️ LID não encontrado');
        return null;
        
    } catch (error) {
        console.error('[BOT ID] ❌ Erro:', error.message);
        return null;
    }
}

async function saveBotLID(groupId, botLID) {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL }
        });

        if (!owner) {
            throw new Error('Owner não encontrado');
        }

        const configs = owner.ownerGroupConfigs || {};
        
        if (!configs[groupId]) {
            configs[groupId] = {};
        }
        
        configs[groupId].botLID = botLID;
        configs[groupId].botLIDDetectedAt = new Date().toISOString();

        await prisma.user.update({
            where: { id: owner.id },
            data: { ownerGroupConfigs: configs }
        });

        console.log('[BOT ID] 💾 LID salvo:', botLID);
        
    } catch (error) {
        console.error('[BOT ID] ❌ Erro ao salvar LID:', error.message);
    }
}

async function getSavedBotLID(groupId) {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL },
            select: { ownerGroupConfigs: true }
        });

        const configs = owner?.ownerGroupConfigs || {};
        const groupConfig = configs[groupId] || {};
        
        return groupConfig.botLID || null;
        
    } catch (error) {
        console.error('[BOT ID] ❌ Erro ao buscar LID:', error.message);
        return null;
    }
}

async function updateBotLID(groupId, newBotLID) {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL }
        });

        if (!owner) {
            throw new Error('Owner não encontrado');
        }

        const configs = owner.ownerGroupConfigs || {};
        
        if (!configs[groupId]) {
            configs[groupId] = {};
        }
        
        configs[groupId].botLID = newBotLID;
        configs[groupId].botLIDUpdatedAt = new Date().toISOString();
        configs[groupId].botLIDManuallySet = true;

        await prisma.user.update({
            where: { id: owner.id },
            data: { ownerGroupConfigs: configs }
        });

        console.log('[BOT ID] ✅ LID atualizado:', newBotLID);
        return true;
        
    } catch (error) {
        console.error('[BOT ID] ❌ Erro ao atualizar LID:', error.message);
        return false;
    }
}

async function resetBotLID(groupId) {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL }
        });

        if (!owner) {
            throw new Error('Owner não encontrado');
        }

        const configs = owner.ownerGroupConfigs || {};
        
        if (configs[groupId]) {
            delete configs[groupId].botLID;
            delete configs[groupId].botLIDDetectedAt;
            delete configs[groupId].botLIDManuallySet;
        }

        await prisma.user.update({
            where: { id: owner.id },
            data: { ownerGroupConfigs: configs }
        });

        console.log('[BOT ID] 🔄 LID resetado');
        return true;
        
    } catch (error) {
        console.error('[BOT ID] ❌ Erro ao resetar LID:', error.message);
        return false;
    }
}

// ✅ VERSÃO SIMPLIFICADA - COMPARA NÚMEROS SEM LID
function normalizePhoneNumber(jid) {
    if (!jid) return null;
    // Remove tudo exceto números
    const numbers = jid.replace(/\D/g, '');
    // Retorna últimos 11-13 dígitos (com DDD e código país)
    return numbers.slice(-13);
}

async function isBotMentionedOrReplied(groupId, mentionedJids, replyParticipant, sock) {
    try {
        // Pega o número real do bot conectado
        const botRealNumber = sock?.user?.id?.split(':')[0]?.replace(/\D/g, '');
        
        if (!botRealNumber) {
            console.log('[BOT ID] ❌ Não foi possível pegar número do bot');
            return false;
        }
        
        console.log('[BOT ID] 🔑 Número real do bot:', botRealNumber);
        
        // Pega LID salvo (se existir)
        let botLID = await getSavedBotLID(groupId);
        
        console.log('[BOT ID] 📋 LID salvo:', botLID || 'Nenhum');
        
        // Verifica reply
        if (replyParticipant) {
            const replyNum = normalizePhoneNumber(replyParticipant);
            const botNum = normalizePhoneNumber(botRealNumber);
            const lidNum = botLID ? normalizePhoneNumber(botLID) : null;
            
            console.log('[BOT ID] 🔍 Comparando reply:');
            console.log('[BOT ID]    - Reply:', replyNum);
            console.log('[BOT ID]    - Bot:', botNum);
            console.log('[BOT ID]    - LID:', lidNum);
            
            // Compara com número real OU com LID salvo
            if (replyNum === botNum || (lidNum && replyNum === lidNum)) {
                console.log('[BOT ID] ✅ É reply para o bot!');
                return true;
            }
        }
        
        // Verifica menções
        if (mentionedJids && mentionedJids.length > 0) {
            const botNum = normalizePhoneNumber(botRealNumber);
            const lidNum = botLID ? normalizePhoneNumber(botLID) : null;
            
            console.log('[BOT ID] 🔍 Verificando menções:');
            
            for (const mention of mentionedJids) {
                const mentionNum = normalizePhoneNumber(mention);
                
                console.log('[BOT ID]    - Menção:', mentionNum, '→', mention);
                
                // Compara números normalizados
                if (mentionNum === botNum || (lidNum && mentionNum === lidNum)) {
                    console.log('[BOT ID] ✅ Bot foi mencionado!');
                    
                    // Se não tinha LID salvo, salva agora
                    if (!botLID && mention.includes('@lid')) {
                        console.log('[BOT ID] 💾 Salvando LID da menção:', mention);
                        await saveBotLID(groupId, mention);
                    }
                    
                    return true;
                }
            }
        }
        
        console.log('[BOT ID] ❌ Bot não foi mencionado nem recebeu reply');
        return false;
        
    } catch (error) {
        console.error('[BOT ID] ❌ Erro:', error.message);
        return false;
    }
}

async function getAllBotLIDs() {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL },
            select: { ownerGroupConfigs: true }
        });

        const configs = owner?.ownerGroupConfigs || {};
        const result = {};
        
        for (const [groupId, config] of Object.entries(configs)) {
            if (config.botLID) {
                result[groupId] = {
                    botLID: config.botLID,
                    detectedAt: config.botLIDDetectedAt,
                    manuallySet: config.botLIDManuallySet || false
                };
            }
        }
        
        return result;
        
    } catch (error) {
        console.error('[BOT ID] ❌ Erro:', error.message);
        return {};
    }
}

module.exports = {
    detectAndSaveBotLID,
    saveBotLID,
    getSavedBotLID,
    updateBotLID,
    resetBotLID,
    isBotMentionedOrReplied,
    getAllBotLIDs
};