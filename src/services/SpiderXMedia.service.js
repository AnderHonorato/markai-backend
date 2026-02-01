// backend/src/services/SpiderXMedia.service.js
// ✅ VERSÃO BLINDADA CONTRA ERROS GLIB/BUFFER + NOVOS RECURSOS

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const SPIDER_API_TOKEN = process.env.SPIDER_API_TOKEN;
const SPIDER_API_BASE_URL = 'https://api.spiderx.com.br';

/**
 * 🛠️ FUNÇÃO AUXILIAR: Verifica se o buffer é um WebP válido
 * Evita o erro: "Input buffer has corrupt header" e crashes do GLib
 */
function isValidWebP(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
    // Verifica os Magic Bytes: "RIFF" no inicio e "WEBP" no offset 8
    const isRiff = buffer.toString('ascii', 0, 4) === 'RIFF';
    const isWebp = buffer.toString('ascii', 8, 12) === 'WEBP';
    return isRiff && isWebp;
}

/**
 * ✅ DETECTA REQUISIÇÕES DE MÍDIA (CORRIGIDO - REGEX MELHORADO)
 */
function detectMediaRequest(message) {
    if (!message) return null;
    const msgLower = message.toLowerCase().trim();
    
    // ✅ DETECTA URL DO INSTAGRAM (MELHORADO)
    const instagramUrlMatch = message.match(/https?:\/\/(www\.)?instagram\.com\/[^\s\n]+/i);
    if (instagramUrlMatch) {
        console.log('[SpiderXMedia] 🔍 URL do Instagram detectada:', instagramUrlMatch[0]);
        return { type: 'instagram', url: instagramUrlMatch[0] };
    }
    
    // ✅ DETECTA URL DO TIKTOK (MELHORADO)
    const tiktokUrlMatch = message.match(/https?:\/\/(www\.)?(vt\.tiktok\.com|tiktok\.com|vm\.tiktok\.com)\/[^\s\n]+/i);
    if (tiktokUrlMatch) {
        console.log('[SpiderXMedia] 🔍 URL do TikTok detectada:', tiktokUrlMatch[0]);
        return { type: 'tiktok', url: tiktokUrlMatch[0] };
    }
    
    // ✅ DETECTA URL DO YOUTUBE (MELHORADO)
    const youtubeUrlMatch = message.match(/https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[^\s\n]+/i);
    if (youtubeUrlMatch) {
        console.log('[SpiderXMedia] 🔍 URL do YouTube detectada:', youtubeUrlMatch[0]);
        return { type: 'youtube_video', url: youtubeUrlMatch[0] };
    }
    
    // ✅ GERAR IMAGEM (FLUX)
    const imageKeywords = [
        'gerar imagem', 'criar imagem', 'gere uma imagem', 'crie uma imagem',
        'gera uma imagem', 'cria uma imagem', 'faça uma imagem', 'faz uma imagem',
        'desenhe', 'desenha', 'fazer imagem', 'crie imagem', 'imagem de'
    ];
    
    for (const keyword of imageKeywords) {
        if (msgLower.includes(keyword)) {
            const index = msgLower.indexOf(keyword);
            const prompt = message.substring(index + keyword.length).trim();
            
            if (prompt.length > 3) {
                return { type: 'image', prompt: prompt };
            }
        }
    }
    
    // ✅ BAIXAR MÚSICA/ÁUDIO
    const audioKeywords = [
        'baixar música', 'baixa música', 'baixe música',
        'baixar musica', 'baixa musica', 'baixe musica',
        'tocar música', 'toca música', 'toque música',
        'tocar musica', 'toca musica', 'toque musica',
        'play música', 'play musica', 'play ',
        'baixe audio', 'baixar audio', 'baixe áudio', 'baixar áudio'
    ];
    
    for (const keyword of audioKeywords) {
        if (msgLower.startsWith(keyword) || msgLower.includes(' ' + keyword)) {
            const index = msgLower.indexOf(keyword);
            const search = message.substring(index + keyword.length).trim();
            
            if (search.length > 2 && 
                !msgLower.includes('top ') && 
                !msgLower.includes('lista') && 
                !msgLower.includes('listar')) {
                return { type: 'audio', search: search };
            }
        }
    }
    
    // ✅ GERAR FIGURINHA ATTP (TEXTO)
    const stickerTextKeywords = [
        'figurinha attp', 'attp ', 'sticker attp',
        'criar figurinha attp', 'criar sticker attp', 
        'gerar figurinha attp', 'gerar sticker attp'
    ];
    
    for (const keyword of stickerTextKeywords) {
        if (msgLower.includes(keyword)) {
            const index = msgLower.indexOf(keyword);
            const text = message.substring(index + keyword.length).trim();
            
            if (text.length > 0) {
                return { type: 'sticker_text', text: text };
            }
        }
    }
    
    // ✅ CRIAR FIGURINHA DE IMAGEM
    const stickerImageKeywords = [
        'criar figurinha', 'criar sticker', 'fazer figurinha', 
        'fazer sticker', 'gerar figurinha', 'gerar sticker',
        'transformar em figurinha', 'converter em figurinha'
    ];
    
    for (const keyword of stickerImageKeywords) {
        if (msgLower.includes(keyword)) {
            if (!msgLower.includes('attp')) {
                return { type: 'sticker_image' };
            }
        }
    }
    
    // ✅ GERAR GIF
    const gifKeywords = [
        'gerar gif', 'criar gif', 'fazer gif',
        'gere um gif', 'crie um gif', 'faça um gif'
    ];
    
    for (const keyword of gifKeywords) {
        if (msgLower.includes(keyword)) {
            const index = msgLower.indexOf(keyword);
            const description = message.substring(index + keyword.length).trim();
            
            if (description.length > 3) {
                return { type: 'gif', description: description };
            }
        }
    }
    
    return null;
}

/**
 * ✅ GERAR IMAGEM (FLUX) - ENDPOINT CORRETO
 */
async function generateImage(prompt) {
    try {
        console.log('[SpiderXMedia] 🎨 Gerando imagem com Flux:', prompt);
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }
        
        const url = `${SPIDER_API_BASE_URL}/api/ai/flux`;
        
        console.log('[SpiderXMedia] 📤 URL:', url);
        console.log('[SpiderXMedia] 🔑 Token:', SPIDER_API_TOKEN.substring(0, 10) + '...');
        
        const response = await axios.get(url, {
            params: {
                text: prompt,
                api_key: SPIDER_API_TOKEN
            },
            timeout: 60000
        });
        
        console.log('[SpiderXMedia] 📥 Resposta:', JSON.stringify(response.data));
        
        if (response.data?.success && response.data?.image) {
            console.log('[SpiderXMedia] ✅ Imagem gerada com sucesso!');
            console.log('[SpiderXMedia] 🖼️ URL da imagem:', response.data.image);
            
            return {
                success: true,
                imageUrl: response.data.image
            };
        } else {
            throw new Error('Resposta inválida da API');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao gerar imagem:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Status:', error.response.status);
            console.error('[SpiderXMedia] 📥 Dados:', JSON.stringify(error.response.data));
        }
        
        return {
            success: false,
            error: 'Não consegui gerar a imagem. Tente uma descrição diferente ou mais simples.'
        };
    }
}

/**
 * ✅ BAIXAR MÚSICA (PLAY AUDIO) - ENDPOINT CORRETO
 */
async function downloadAudio(search) {
    try {
        console.log('[SpiderXMedia] 🎵 Procurando música:', search);
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }
        
        const url = `${SPIDER_API_BASE_URL}/api/downloads/play-audio`;
        
        console.log('[SpiderXMedia] 📤 URL:', url);
        console.log('[SpiderXMedia] 🔍 Buscando:', search);
        
        const response = await axios.get(url, {
            params: {
                search: search,
                api_key: SPIDER_API_TOKEN
            },
            timeout: 90000
        });
        
        console.log('[SpiderXMedia] 📥 Resposta:', JSON.stringify(response.data).substring(0, 300));
        
        if (response.data?.url) {
            console.log('[SpiderXMedia] ✅ Áudio baixado com sucesso!');
            console.log('[SpiderXMedia] 🎵 Título:', response.data.title);
            console.log('[SpiderXMedia] 🔗 URL do áudio:', response.data.url);
            
            return {
                success: true,
                audioUrl: response.data.url,
                title: response.data.title || search,
                channel: response.data.channel?.name || 'Desconhecido',
                duration: response.data.total_duration_in_seconds || 0,
                youtubeUrl: response.data.youtube_video_url || '',
                thumbnail: response.data.thumbnail || ''
            };
        } else {
            throw new Error('Áudio não encontrado na resposta');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao baixar música:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Status:', error.response.status);
            console.error('[SpiderXMedia] 📥 Dados:', JSON.stringify(error.response.data));
        }
        
        return {
            success: false,
            error: 'Não consegui baixar a música.\n\nTente:\n• Verificar o nome da música\n• Incluir o nome do artista\n• Usar palavras-chave mais específicas'
        };
    }
}

/**
 * ✅ BAIXAR VÍDEO DO INSTAGRAM (NOVO)
 */
async function downloadInstagram(url) {
    try {
        console.log('[SpiderXMedia] 📸 Baixando do Instagram:', url);
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }
        
        const apiUrl = `${SPIDER_API_BASE_URL}/api/downloads/instagram`;
        
        console.log('[SpiderXMedia] 📤 URL:', apiUrl);
        
        const response = await axios.get(apiUrl, {
            params: {
                url: url,
                api_key: SPIDER_API_TOKEN
            },
            timeout: 60000
        });
        
        console.log('[SpiderXMedia] 📥 Resposta:', JSON.stringify(response.data).substring(0, 300));
        
        if (response.data?.url) {
            console.log('[SpiderXMedia] ✅ Vídeo do Instagram baixado com sucesso!');
            
            return {
                success: true,
                videoUrl: response.data.url,
                title: response.data.title || 'Post do Instagram',
                thumbnail: response.data.thumb || '',
                meta: response.data.meta || {}
            };
        } else {
            throw new Error('URL do vídeo não encontrada na resposta');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao baixar do Instagram:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Status:', error.response.status);
            console.error('[SpiderXMedia] 📥 Dados:', JSON.stringify(error.response.data));
        }
        
        return {
            success: false,
            error: 'Não consegui baixar o vídeo do Instagram.\n\nVerifique se o link está correto e se o post é público.'
        };
    }
}

/**
 * ✅ BAIXAR VÍDEO DO TIKTOK (NOVO)
 */
async function downloadTikTok(url) {
    try {
        console.log('[SpiderXMedia] 🎵 Baixando do TikTok:', url);
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }
        
        const apiUrl = `${SPIDER_API_BASE_URL}/api/downloads/tik-tok`;
        
        console.log('[SpiderXMedia] 📤 URL:', apiUrl);
        
        const response = await axios.get(apiUrl, {
            params: {
                url: url,
                api_key: SPIDER_API_TOKEN
            },
            timeout: 60000
        });
        
        console.log('[SpiderXMedia] 📥 Resposta:', JSON.stringify(response.data));
        
        if (response.data?.download_link) {
            console.log('[SpiderXMedia] ✅ Vídeo do TikTok baixado com sucesso!');
            
            return {
                success: true,
                videoUrl: response.data.download_link
            };
        } else {
            throw new Error('Link de download não encontrado na resposta');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao baixar do TikTok:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Status:', error.response.status);
            console.error('[SpiderXMedia] 📥 Dados:', JSON.stringify(error.response.data));
        }
        
        return {
            success: false,
            error: 'Não consegui baixar o vídeo do TikTok.\n\nVerifique se o link está correto.'
        };
    }
}

/**
 * ✅ BAIXAR VÍDEO DO YOUTUBE (MP4) (NOVO)
 */
async function downloadYouTubeVideo(url) {
    try {
        console.log('[SpiderXMedia] 🎬 Baixando vídeo do YouTube:', url);
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }
        
        const apiUrl = `${SPIDER_API_BASE_URL}/api/downloads/yt-mp4`;
        
        console.log('[SpiderXMedia] 📤 URL:', apiUrl);
        
        const response = await axios.get(apiUrl, {
            params: {
                url: url,
                api_key: SPIDER_API_TOKEN
            },
            timeout: 120000 // 2 minutos para vídeos maiores
        });
        
        console.log('[SpiderXMedia] 📥 Resposta:', JSON.stringify(response.data).substring(0, 300));
        
        if (response.data?.url) {
            console.log('[SpiderXMedia] ✅ Vídeo do YouTube baixado com sucesso!');
            
            return {
                success: true,
                videoUrl: response.data.url,
                title: response.data.title || 'Vídeo do YouTube',
                description: response.data.description || '',
                thumbnail: response.data.thumbnail || '',
                duration: response.data.total_duration_in_seconds || 0,
                channel: response.data.channel || {}
            };
        } else {
            throw new Error('URL do vídeo não encontrada na resposta');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao baixar vídeo do YouTube:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Status:', error.response.status);
            console.error('[SpiderXMedia] 📥 Dados:', JSON.stringify(error.response.data));
        }
        
        return {
            success: false,
            error: 'Não consegui baixar o vídeo do YouTube.\n\nVerifique se o link está correto.'
        };
    }
}

/**
 * ✅ GERAR FIGURINHA ATTP - ENDPOINT CORRETO
 */
async function generateAttpSticker(text) {
    try {
        console.log('[SpiderXMedia] 📝 Gerando figurinha ATTP:', text);
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }
        
        const url = `${SPIDER_API_BASE_URL}/api/stickers/attp`;
        
        console.log('[SpiderXMedia] 📤 URL:', url);
        console.log('[SpiderXMedia] ✍️ Texto:', text);
        
        const response = await axios.get(url, {
            params: {
                text: text,
                api_key: SPIDER_API_TOKEN
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });
        
        const buffer = Buffer.from(response.data);
        
        if (buffer && buffer.length > 1000 && isValidWebP(buffer)) {
            console.log('[SpiderXMedia] ✅ Figurinha ATTP gerada com sucesso!');
            console.log('[SpiderXMedia] 📦 Tamanho:', buffer.length, 'bytes');
            
            return {
                success: true,
                stickerBuffer: buffer
            };
        } else {
            console.error('[SpiderXMedia] ⚠️ Resposta ATTP inválida ou corrompida');
            throw new Error('Buffer inválido ou não é WebP');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao gerar figurinha:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Status:', error.response.status);
        }
        
        return {
            success: false,
            error: 'Não consegui gerar a figurinha.\n\nDica: Use textos curtos (até 30 caracteres) com apenas letras e números.'
        };
    }
}

/**
 * ✅ CRIAR FIGURINHA DE IMAGEM
 */
async function createImageSticker(imageBuffer, packName = 'AlphaBot', authorName = 'Ander') {
    try {
        console.log('[SpiderXMedia] 🖼️ Criando figurinha de imagem');
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }

        if (!Buffer.isBuffer(imageBuffer)) {
            throw new Error('O arquivo fornecido não é um Buffer válido');
        }
        
        console.log(`[SpiderXMedia] 📤 Enviando imagem: ${imageBuffer.length} bytes`);
        
        const url = `${SPIDER_API_BASE_URL}/api/stickers/create`;
        
        const formData = new FormData();
        formData.append('image', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
        formData.append('pack', packName);
        formData.append('author', authorName);
        
        const response = await axios.post(url, formData, {
            headers: {
                ...formData.getHeaders(),
                'X-API-Key': SPIDER_API_TOKEN
            },
            responseType: 'arraybuffer',
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 45000
        });
        
        const stickerBuffer = Buffer.from(response.data);

        if (stickerBuffer && stickerBuffer.length > 1000) {
            if (isValidWebP(stickerBuffer)) {
                console.log('[SpiderXMedia] ✅ Figurinha criada e validada com sucesso!');
                console.log('[SpiderXMedia] 📦 Tamanho:', stickerBuffer.length, 'bytes');
                
                return {
                    success: true,
                    stickerBuffer: stickerBuffer
                };
            } else {
                console.error('[SpiderXMedia] ⚠️ A API retornou dados, mas não é um WebP válido.');
                throw new Error('A API retornou um arquivo que não é uma figurinha válida.');
            }
        } else {
            throw new Error('Resposta muito pequena ou vazia');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao criar figurinha:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Status:', error.response.status);
            try {
                const errData = Buffer.from(error.response.data).toString();
                console.error('[SpiderXMedia] 📥 Detalhe Erro:', errData.substring(0, 200));
            } catch (e) {}
        }
        
        return {
            success: false,
            error: 'Não consegui criar a figurinha.\n\nCertifique-se de enviar uma imagem válida (JPG, PNG).'
        };
    }
}

/**
 * ✅ CONVERTER WEBP PARA GIF (TO-GIF)
 */
async function convertWebpToGif(webpBuffer) {
    try {
        console.log('[SpiderXMedia] 🎬 Convertendo WebP para GIF');
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }
        
        const url = `${SPIDER_API_BASE_URL}/api/utilities/to-gif`;
        
        const formData = new FormData();
        formData.append('file', webpBuffer, 'animation.webp');
        
        const response = await axios.post(url, formData, {
            headers: {
                ...formData.getHeaders(),
                'X-API-Key': SPIDER_API_TOKEN
            },
            maxBodyLength: Infinity,
            timeout: 30000
        });
        
        if (response.data?.url) {
            console.log('[SpiderXMedia] ✅ GIF gerado com sucesso!');
            return {
                success: true,
                gifUrl: response.data.url
            };
        } else {
            throw new Error('URL do GIF não encontrada');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao converter para GIF:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Dados:', JSON.stringify(error.response.data));
        }
        
        return {
            success: false,
            error: 'Não foi possível converter para GIF.'
        };
    }
}

/**
 * ✅ CONVERSAR COM GPT-5 MINI (GEMINI) - INTEGRAÇÃO COMPLETA
 */
async function chatWithGPT5Mini(text, conversationHistory = []) {
    try {
        console.log('[SpiderXMedia] 🤖 Conversando com GPT-5 Mini:', text);
        
        if (!SPIDER_API_TOKEN) {
            throw new Error('SPIDER_API_TOKEN não configurado');
        }
        
        const url = `${SPIDER_API_BASE_URL}/api/ai/gpt-5-mini`;
        
        let fullText = text;
        
        if (conversationHistory.length > 0) {
            const contextLines = conversationHistory.slice(-5).map(msg => {
                return `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`;
            });
            
            fullText = contextLines.join('\n') + '\n\nUsuário: ' + text;
        }
        
        console.log('[SpiderXMedia] 📤 URL:', url);
        console.log('[SpiderXMedia] 💬 Texto enviado (primeiros 100 chars):', fullText.substring(0, 100));
        
        const response = await axios.post(
            `${url}?api_key=${SPIDER_API_TOKEN}`,
            { text: fullText },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            }
        );
        
        console.log('[SpiderXMedia] 📥 Resposta:', JSON.stringify(response.data).substring(0, 200));
        
        if (response.data?.success && response.data?.response) {
            console.log('[SpiderXMedia] ✅ Resposta gerada!');
            
            return {
                success: true,
                response: response.data.response
            };
        } else {
            throw new Error('Resposta inválida da API');
        }
        
    } catch (error) {
        console.error('[SpiderXMedia] ❌ Erro ao conversar com GPT-5 Mini:', error.message);
        
        if (error.response) {
            console.error('[SpiderXMedia] 📥 Status:', error.response.status);
            console.error('[SpiderXMedia] 📥 Dados:', JSON.stringify(error.response.data));
        }
        
        return {
            success: false,
            error: 'Não consegui processar sua mensagem. Tente novamente.'
        };
    }
}

/**
 * ✅ FUNÇÃO DE DIAGNÓSTICO DA API
 */
async function diagnoseSpiderAPI() {
    console.log('\n' + '='.repeat(70));
    console.log('🔧 DIAGNÓSTICO COMPLETO DA SPIDER API');
    console.log('='.repeat(70));
    
    console.log('\n1️⃣ CONFIGURAÇÃO:');
    console.log('   Base URL:', SPIDER_API_BASE_URL);
    console.log('   Token:', SPIDER_API_TOKEN ? `${SPIDER_API_TOKEN.substring(0, 10)}...` : '❌ NÃO CONFIGURADO');
    
    if (!SPIDER_API_TOKEN) {
        console.log('\n❌ Token não encontrado! Configure SPIDER_API_TOKEN no arquivo .env');
        return false;
    }
    
    console.log('\n2️⃣ TESTANDO ENDPOINTS:');
    
    const tests = [
        {
            name: 'Flux (Imagem)',
            test: () => generateImage('um cachorro feliz')
        },
        {
            name: 'Play Audio (Música)',
            test: () => downloadAudio('teste')
        },
        {
            name: 'ATTP (Figurinha)',
            test: () => generateAttpSticker('Olá')
        },
        {
            name: 'GPT-5 Mini (Chat)',
            test: () => chatWithGPT5Mini('Olá')
        }
    ];
    
    for (const test of tests) {
        try {
            console.log(`\n   🔍 Testando: ${test.name}`);
            const result = await test.test();
            
            if (result.success) {
                console.log(`   ✅ ${test.name} → FUNCIONANDO`);
            } else {
                console.log(`   ⚠️ ${test.name} → ERRO:`, result.error);
            }
        } catch (error) {
            console.log(`   ❌ ${test.name} → FALHOU:`, error.message);
        }
    }
    
    console.log('\n' + '='.repeat(70) + '\n');
    return true;
}

module.exports = {
    detectMediaRequest,
    generateImage,
    downloadAudio,
    downloadInstagram,
    downloadTikTok,
    downloadYouTubeVideo,
    generateAttpSticker,
    createImageSticker,
    convertWebpToGif,
    chatWithGPT5Mini,
    diagnoseSpiderAPI
};