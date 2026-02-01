// backend/src/bot-owner.js
// ✅ VERSÃO COMPLETA - SEM REAÇÕES EM PRIVADO

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { processOwnerMessage, processarMensagemComDebounce } = require('./services/Owner.ai.service');
const spiderXMedia = require('./services/SpiderXMedia.service');
const botIdentification = require('./services/Botidentification.service');
const moltbookDiary = require('./services/MoltbookDiary.service'); 
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const OWNER_EMAIL = 'contato.markaiapp@gmail.com';

async function isGroupAIEnabled(groupId) {
    try {
        const owner = await prisma.user.findFirst({
            where: { email: OWNER_EMAIL },
            select: { ownerGroupConfigs: true }
        });
        if (!owner) return true;
        const configs = owner.ownerGroupConfigs || {};
        const groupConfig = configs[groupId] || {};
        return groupConfig.aiEnabled !== false;
    } catch (error) {
        console.error('[OWNER BOT] Erro ao verificar IA do grupo:', error.message);
        return true;
    }
}

async function getUserName(sock, groupId, userJid) {
    try {
        const groupMetadata = await sock.groupMetadata(groupId);
        if (!groupMetadata || !groupMetadata.participants) return null;
        const participant = groupMetadata.participants.find(p => p.id === userJid);
        if (participant) {
            const contact = await sock.onWhatsApp(userJid);
            if (contact && contact[0]?.notify) {
                console.log('[OWNER BOT] 👤 Nome do usuário:', contact[0].notify);
                return contact[0].notify;
            }
        }
        return null;
    } catch (error) {
        console.error('[OWNER BOT] ❌ Erro ao buscar nome do usuário:', error.message);
        return null;
    }
}

function extractMentions(message) {
    const mentions = [];
    if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
        mentions.push(...message.message.extendedTextMessage.contextInfo.mentionedJid);
    }
    
    if (message.message?.imageMessage?.contextInfo?.mentionedJid) {
        mentions.push(...message.message.imageMessage.contextInfo.mentionedJid);
    }
    
    const textSources = [
        message.message?.conversation,
        message.message?.extendedTextMessage?.text,
        message.message?.imageMessage?.caption
    ];
    
    for (const text of textSources) {
        if (text && text.includes('@')) {
            const mentionRegex = /@(\d+)/g;
            let match;
            while ((match = mentionRegex.exec(text)) !== null) {
                mentions.push(`${match[1]}@s.whatsapp.net`);
                mentions.push(`${match[1]}@lid`);
            }
        }
    }
    return [...new Set(mentions)];
}

async function reactToMessage(sock, remoteJid, messageKey, emoji) {
    try {
        await sock.sendMessage(remoteJid, {
            react: { text: emoji, key: messageKey }
        });
        console.log(`[OWNER BOT] ✅ Reação enviada: ${emoji}`);
    } catch (error) {
        console.error('[OWNER BOT] ❌ Erro ao reagir:', error.message);
    }
}

function registerInteraction(type, content, user, isGroup, groupName, result = null) {
    moltbookDiary.registerInteraction({
        type,
        user,
        content,
        isGroup,
        groupName,
        result
    });
}

/**
 * 🔮 DADOS COMPLETOS DO HORÓSCOPO (Conforme horoscopo.js)
 */
const SIGNOS_RESUMO_FIXO = {
    "aries": { elemento: "Fogo", periodo: "21 de Março - 19 de Abril", regente: "Marte" },
    "touro": { elemento: "Terra", periodo: "20 de Abril - 20 de Maio", regente: "Vênus" },
    "gemeos": { elemento: "Ar", periodo: "21 de Maio - 20 de Junho", regente: "Mercúrio" },
    "cancer": { elemento: "Água", periodo: "21 de Junho - 22 de Julho", regente: "Lua" },
    "leao": { elemento: "Fogo", periodo: "23 de Julho - 22 de Agosto", regente: "Sol" },
    "virgem": { elemento: "Terra", periodo: "23 de Agosto - 22 de Setembro", regente: "Mercúrio" },
    "libra": { elemento: "Ar", periodo: "23 de Setembro - 22 de Outubro", regente: "Vênus" },
    "escorpiao": { elemento: "Água", periodo: "23 de Outubro - 21 de Novembro", regente: "Plutão" },
    "sagitario": { elemento: "Fogo", periodo: "22 de Novembro - 21 de Dezembro", regente: "Júpiter" },
    "capricornio": { elemento: "Terra", periodo: "22 de Dezembro - 19 de Janeiro", regente: "Saturno" },
    "aquario": { elemento: "Ar", periodo: "20 de Janeiro - 18 de Fevereiro", regente: "Urano" },
    "peixes": { elemento: "Água", periodo: "19 de Fevereiro - 20 de Março", regente: "Netuno" }
};

const SIGNOS_EMOJIS = {
    "aries": "♈", "touro": "♉", "gemeos": "♊", "cancer": "♋", "leao": "♌", "virgem": "♍",
    "libra": "♎", "escorpiao": "♏", "sagitario": "♐", "capricornio": "♑", "aquario": "♒", "peixes": "♓"
};

const HOROSCOPO_FAKE_DATA = {
    "aries": [
        "Aproveite a energia ardente de hoje, Áries, para iniciar novos projetos com paixão e vigor. Sua determinação inabalável será o combustível para alcançar recompensas significativas e superar qualquer obstáculo que se apresente.",
        "Desafios podem surgir inesperadamente no seu caminho hoje, Áries, mas não se intimide! Sua coragem inata e sua capacidade de agir rapidamente o farão superá-los com facilidade, transformando-os em oportunidades de crescimento pessoal e profissional.",
        "Reserve um momento para a introspecção e a reflexão, Áries. Essa pausa pode trazer clareza essencial para definir seus próximos passos e alinhar suas ações com seus verdadeiros desejos. Ouça atentamente sua intuição; ela pode revelar o caminho mais promissor.",
        "Hoje, exercite um pouco mais de paciência, Áries. Nem tudo precisa ser feito na sua velocidade habitual. Dar tempo ao tempo e respeitar o ritmo dos outros pode levar a resultados mais harmoniosos e duradouros em suas relações e projetos.",
        "Sua paixão e entusiasmo são contagiantes, Áries! Use essa energia poderosa para inspirar as pessoas ao seu redor, motivando-as a perseguir seus próprios sonhos e objetivos com a mesma intensidade. Sua liderança natural fará a diferença no ambiente coletivo.",
        "Um novo começo se apresenta, Áries. Esteja pronto para abraçá-lo com a cabeça erguida e o coração aberto, pois ele trará consigo oportunidades únicas de renovação e expansão em diversas áreas da sua vida.",
        "Sua independência é uma força, Áries, mas hoje, considere colaborar. A união de forças pode trazer soluções inovadoras e resultados muito além do que você conseguiria sozinho.",
        "Evite a impulsividade excessiva, Áries. Uma pequena pausa para analisar as consequências antes de agir pode evitar arrependimentos e garantir que suas decisões sejam mais assertivas.",
        "A liderança é sua segunda natureza. Assuma o controle de situações que precisam de direção, mas lembre-se de ouvir as opiniões dos outros para uma abordagem mais completa e eficaz.",
        "Um conflito pode surgir, Áries, mas sua honestidade e franqueza serão suas melhores armas para resolvê-lo. Aborde a situação com clareza e sem rodeios, buscando uma solução justa.",
        "Sua energia física está alta hoje, Áries! Direcione-a para atividades que promovam seu bem-estar, seja um esporte, uma caminhada vigorosa ou qualquer coisa que o faça sentir-se vivo e forte.",
        "Reconheça e celebre suas pequenas vitórias, Áries. Cada passo dado em direção aos seus objetivos merece ser valorizado, pois são eles que pavimentam o caminho para grandes conquistas futuras.",
        "Um desafio criativo pode surgir, Áries. Deixe sua imaginação fluir livremente e não tenha medo de experimentar. Suas ideias originais têm o poder de transformar o comum em extraordinário.",
        "Sua assertividade será um trunfo em negociações ou discussões importantes. Defenda seus pontos de vista com convicção, mas mantenha a mente aberta para o diálogo e a possibilidade de acordos.",
        "Hoje é um dia excelente para expressar seus sentimentos mais profundos, Áries. Seja com palavras ou gestos, comunicar o que sente pode fortalecer laços e trazer mais autenticidade para suas relações.",
        "Mantenha o foco em seus objetivos de longo prazo, Áries. A visão clara do futuro o ajudará a superar as distrações e a manter-se no caminho certo, mesmo diante de contratempos temporários.",
        "Sua generosidade pode tocar o coração de alguém hoje, Áries. Um ato de bondade, por menor que seja, tem o poder de criar um impacto positivo duradouro na vida de quem o recebe e na sua própria.",
        "Aprenda com seus erros, Áries. Cada tropeço é uma oportunidade valiosa para ajustar sua rota e crescer. Não se culpe, apenas aprenda a lição e siga em frente com mais sabedoria.",
        "Um convite social inesperado pode trazer diversão e novas conexões. Permita-se sair da rotina e interagir, pois nessas ocasiões podem surgir oportunidades de amizade ou networking.",
        "Sua paixão por novas experiências será evidente hoje. Busque algo que o tire da zona de conforto, seja aprender uma nova habilidade ou visitar um lugar diferente, e expanda seus horizontes.",
        "Confie em sua intuição, Áries. Aquela 'sensação' sobre algo ou alguém pode ser um guia importante. Ouça sua voz interior antes de tomar decisões significativas.",
        "Não se deixe abater por críticas construtivas, Áries. Use-as como um espelho para aprimorar suas qualidades e trabalhar em seus pontos fracos, transformando-as em degraus para o seu desenvolvimento.",
        "Sua capacidade de adaptação será testada. Seja flexível diante das mudanças e encontrará soluções criativas. A rigidez pode ser um obstáculo; a fluidez, uma vantagem.",
        "Um projeto pessoal pode ganhar um novo impulso hoje, Áries. Dedique-se com afinco e verá seu esforço recompensado. Sua energia é a força motriz para concretizar suas ambições.",
        "Conecte-se com a natureza, Áries. Um tempo ao ar livre pode renovar suas energias e trazer clareza mental, ajudando a dissipar o estresse e a encontrar um novo equilíbrio.",
        "Sua assertividade é uma qualidade, mas evite a agressividade. Comunique-se com firmeza, mas com respeito, garantindo que sua mensagem seja ouvida sem gerar atritos desnecessários.",
        "Um mentor ou figura de autoridade pode oferecer um conselho valioso hoje, Áries. Esteja aberto a receber orientações e aprender com a experiência de quem já trilhou caminhos semelhantes.",
        "Sua mente está cheia de ideias, Áries. Não as deixe escapar! Anote-as, organize-as e comece a traçar um plano para transformá-las em realidade. O potencial é imenso.",
        "Celebre sua individualidade, Áries. Você é único e suas qualidades intrínsecas merecem ser reconhecidas. Permita-se ser quem você é, sem medo de julgamentos externos.",
        "Áries, o dia pede ação e iniciativa. Não espere pelas coisas acontecerem; faça-as acontecer. Sua proatividade hoje será a chave para desbloquear novas oportunidades e avançar significativamente."
    ],
    "touro": [
        "Desfrute dos pequenos prazeres e confortos da vida hoje, Touro. A calma, a estabilidade e a apreciação do belo são suas maiores forças. Permita-se relaxar e absorver a tranquilidade ao seu redor, encontrando paz nos detalhes e na simplicidade.",
        "Suas finanças estão em alta, Touro! Este é um excelente momento para organizar suas despesas, revisar seus investimentos e planejar o futuro financeiro com sabedoria e prudência. A segurança material trará mais tranquilidade e oportunidades.",
        "Cultive a paciência, Touro, pois os resultados mais duradouros e gratificantes vêm com o tempo e a persistência. Mantenha-se firme em seus objetivos, trabalhando passo a passo, e a colheita será abundante e satisfatória, superando suas expectativas.",
        "Sua teimosia, quando bem direcionada, pode ser um trunfo, Touro, mas saiba a hora de ceder em algumas situações. A flexibilidade pode abrir novas oportunidades e evitar atritos desnecessários nas relações pessoais e profissionais, promovendo a harmonia.",
        "Invista em sua segurança e conforto hoje, Touro, seja no ambiente físico do seu lar ou nas suas relações pessoais. Você merece tranquilidade e estabilidade; crie um espaço que reflita essa paz interior e te traga bem-estar e contentamento.",
        "Um encontro inesperado pode trazer boas notícias ou uma perspectiva nova e interessante. Fique atento aos sinais e às pessoas que cruzam seu caminho, pois algo positivo pode surgir dali, enriquecendo sua rotina.",
        "Hoje é um dia favorável para cuidar da sua saúde e bem-estar, Touro. Considere uma caminhada na natureza, uma alimentação mais balanceada ou um tempo para meditação. Seu corpo e mente agradecerão essa atenção especial.",
        "Aprecie a natureza em sua plenitude e use-a para recarregar suas energias, Touro. O contato com a terra e a beleza natural pode trazer uma sensação profunda de paz e renovação para seu espírito, dissipando qualquer tensão.",
        "Touro, sua determinação é sua maior aliada. Use-a com sabedoria para concretizar seus projetos e superar qualquer obstáculo. Sua persistência é a chave para transformar sonhos em realidade tangível e duradoura.",
        "Um convite social pode ser mais interessante e produtivo do que você imagina, Touro. Saia da sua zona de conforto e interaja; novas conexões ou informações valiosas podem surgir dessas interações, enriquecendo sua vida social.",
        "Sua lealdade é um valor inestimável, Touro. Cultive suas amizades e parcerias com carinho, pois as relações construídas com confiança e dedicação são seu maior tesouro e fonte de apoio.",
        "Pequenas indulgências são permitidas hoje, Touro. Permita-se um prazer simples, seja uma refeição favorita, uma peça de roupa nova ou um momento de puro deleite. Você merece essa recompensa.",
        "Um projeto envolvendo arte ou beleza pode te trazer grande satisfação. Mergulhe em atividades que estimulem seus sentidos e sua criatividade, expressando sua essência taurina.",
        "A paciência que você demonstra em seus projetos hoje será recompensada com resultados sólidos e duradouros. Não apresse o processo; a qualidade vem com o tempo e a dedicação.",
        "Touro, um ambiente tranquilo e harmonioso é essencial para o seu bem-estar. Dedique-se a criar e manter esse espaço, tanto em seu lar quanto em seu local de trabalho, para otimizar sua produtividade e paz.",
        "Sua conexão com o mundo material é forte. Hoje é um bom dia para organizar seus bens, planejar compras ou investimentos, sempre com a praticidade e a segurança que lhe são características.",
        "Evite confrontos desnecessários, Touro. Sua natureza pacífica prefere a harmonia, e hoje, a diplomacia será sua melhor estratégia para resolver quaisquer tensões que possam surgir.",
        "Um diálogo aberto e honesto pode fortalecer um relacionamento importante. Não hesite em expressar suas necessidades e sentimentos com clareza, cultivando a transparência e a confiança.",
        "Touro, sua persistência é a chave para transformar obstáculos em degraus. Mantenha o foco, mesmo quando o caminho parecer difícil, e você alcançará seus objetivos com solidez.",
        "Um momento de silêncio e contato com a natureza pode recarregar suas energias. Busque um local tranquilo para meditar ou simplesmente apreciar a beleza ao seu redor.",
        "A segurança e o conforto da sua rotina são importantes, mas esteja aberto a pequenas inovações. Um novo hábito ou uma mudança sutil pode trazer frescor ao seu dia.",
        "Touro, sua capacidade de concretizar ideias é notável. Dê um passo prático em direção a um sonho antigo. Transformar o intangível em real é sua especialidade.",
        "Um elogio sincero pode aquecer seu coração e te motivar ainda mais. Aprecie o reconhecimento, mas lembre-se que sua maior validação vem da sua própria satisfação.",
        "Hoje é um bom dia para dedicar-se a um passatempo que você ama. Seja cozinhar, jardinagem ou artesanato, atividades manuais trazem paz e satisfação para você, Touro.",
        "Sua teimosia pode ser um escudo, mas também uma barreira. Saiba quando flexibilizar suas posições para abraçar novas oportunidades ou evitar resistências desnecessárias.",
        "Touro, a estabilidade é sua base. Reforce suas fundações hoje, seja no trabalho, nas finanças ou nos relacionamentos, garantindo que tudo esteja sólido e seguro para o futuro.",
        "Pense no futuro com praticidade, Touro. O planejamento cuidadoso hoje garantirá que você colha os frutos do seu trabalho amanhã, construindo um legado de segurança e prosperidade.",
        "Apegue-se aos seus valores, Touro. Eles são sua bússola moral e garantem que suas ações estejam sempre alinhadas com o que você acredita ser correto e justo.",
        "Um momento de apreciação pela beleza ao seu redor pode elevar seu espírito. Olhe para o céu, para uma flor, para uma obra de arte; a estética alimenta sua alma.",
        "Touro, sua força interior é imensa, permitindo que você supere qualquer adversidade com resiliência. Confie na sua capacidade de suportar e persistir, pois a vitória é certa para quem não desiste."
    ],
    "gemeos": [
        "Sua comunicação estará em alta hoje, Gêmeos, permitindo que você se expresse com clareza e desenvoltura em todas as interações. Use suas palavras com sabedoria para conectar pessoas e ideias, transformando conversas em oportunidades valiosas de aprendizado e colaboração.",
        "Novas ideias borbulham incessantemente em sua mente inquieta, Gêmeos. Anote-as imediatamente para não perdê-las e comece a planejá-las, pois entre elas pode estar a semente de um projeto inovador ou uma solução criativa e ágil para um desafio antigo.",
        "Cuidado com a indecisão, Gêmeos. Embora a dualidade e a adaptabilidade sejam suas características marcantes, hoje é fundamental escolher um caminho e seguir em frente com convicção e foco. A ação direcionada trará os melhores resultados e evitará a dispersão.",
        "Interaja com diferentes pessoas e grupos hoje, Gêmeos. Novas perspectivas, informações valiosas e conhecimentos surpreendentes podem surgir de conversas inesperadas, enriquecendo seu repertório mental e sua visão de mundo de forma instigante.",
        "Seu humor leve e sua incrível adaptabilidade serão seus maiores trunfos hoje, Gêmeos. Use-os para navegar por situações complexas com facilidade e transformar momentos de tensão em oportunidades de aprendizado e crescimento social, mostrando sua versatilidade.",
        "Sua curiosidade intelectual estará aguçada, Gêmeos. Mergulhe em novos assuntos, pesquise, leia e absorva conhecimento, pois o aprendizado de hoje pode ser a chave para futuras conquistas e inovações em sua área de interesse.",
        "Evite a superficialidade, Gêmeos. Embora você aprecie a variedade, dedique-se a aprofundar um tema ou uma conversa. A profundidade trará conexões mais significativas e um entendimento mais completo.",
        "Um convite para um evento social ou uma reunião de grupo pode ser muito divertido e produtivo. Permita-se socializar e trocar ideias, pois novas amizades ou oportunidades de networking podem surgir naturalmente.",
        "Gêmeos, sua agilidade mental é um superpoder. Use-a para resolver problemas rapidamente, adaptar-se a imprevistos e encontrar soluções criativas em situações que exigem rapidez de raciocínio.",
        "Cuidado com a fofoca ou informações não verificadas. Sua paixão por comunicar é grande, mas garanta que suas palavras sejam sempre baseadas na verdade e contribuam positivamente.",
        "Um pequeno projeto que exige organização e comunicação pode ser iniciado hoje. Sua capacidade de gerenciar várias tarefas ao mesmo tempo será um diferencial para o sucesso.",
        "Sua versatilidade será sua maior vantagem hoje, Gêmeos. Esteja pronto para mudar de planos, aprender algo novo e adaptar-se a diferentes cenários, mostrando sua flexibilidade inata.",
        "Um diálogo aberto e honesto pode resolver mal-entendidos. Não hesite em iniciar conversas difíceis, usando sua clareza de expressão para buscar a verdade e a reconciliação.",
        "Gêmeos, seu senso de humor é contagiante. Use-o para alegrar o ambiente, descontrair situações tensas e fazer as pessoas ao seu redor se sentirem mais leves e felizes.",
        "Pense em como você pode usar suas habilidades de comunicação para ajudar alguém. Oferecer um conselho, mediar um conflito ou simplesmente ouvir pode fazer uma grande diferença.",
        "Sua mente precisa de estímulo constante. Busque atividades que desafiem seu intelecto, como quebra-cabeças, jogos de estratégia ou debates. Mantenha seu cérebro ativo e engajado.",
        "Gêmeos, não se sobrecarregue com muitas tarefas ao mesmo tempo. Embora você seja multitarefa, focar em uma ou duas prioridades pode garantir uma execução mais eficiente e de qualidade.",
        "Um reencontro com velhos amigos ou familiares pode trazer memórias agradáveis e conversas enriquecedoras. Valorize esses laços e a troca de experiências.",
        "Sua adaptabilidade permite que você se encaixe em qualquer grupo. Use essa habilidade para construir pontes e conectar pessoas que, à primeira vista, parecem diferentes.",
        "Gêmeos, a leitura é um portal para novos mundos. Dedique um tempo hoje para um livro interessante ou artigos que expandam seu conhecimento e sua visão de vida.",
        "Sua necessidade de liberdade é forte. Evite compromissos que o prendam excessivamente ou limitem sua capacidade de explorar e experimentar coisas novas.",
        "Um projeto em equipe pode ser muito bem-sucedido com sua contribuição, Gêmeos. Sua capacidade de comunicar ideias e coordenar esforços será fundamental para o êxito coletivo.",
        "Gêmeos, não tenha medo de expressar sua individualidade e suas opiniões únicas. Sua originalidade é um trunfo, e suas perspectivas diferentes podem inspirar mudanças positivas.",
        "Um dia ideal para aprender algo novo, seja um idioma, uma ferramenta ou um software. Sua mente absorve informações rapidamente; aproveite para expandir seu repertório.",
        "Sua vivacidade e energia podem ser inspiradoras para os outros. Compartilhe seu entusiasmo e sua curiosidade, contagiando as pessoas ao seu redor com sua sede por conhecimento.",
        "Gêmeos, a variedade é o tempero da sua vida. Experimente algo diferente hoje, seja uma nova comida, um novo caminho para o trabalho ou uma atividade fora da sua rotina.",
        "Mantenha-se informado sobre os acontecimentos ao seu redor. Sua mente curiosa aprecia estar por dentro das novidades e tendências, o que pode te dar insights valiosos.",
        "Gêmeos, sua capacidade de argumentação é forte. Use-a para defender causas justas ou para apresentar suas ideias de forma convincente, mas sempre com respeito aos outros.",
        "Um pequeno gesto de carinho e atenção pode fazer uma grande diferença em um relacionamento. Sua comunicação pode ser verbal ou através de atitudes significativas.",
        "Gêmeos, confie na sua intuição para navegar por situações sociais. Sua sensibilidade para captar energias e intenções será um guia valioso hoje."
    ],
    "cancer": [
        "Sua sensibilidade estará aguçada hoje, Câncer, permitindo que você capte nuances emocionais profundas. Cuide de si e das suas emoções com carinho, buscando ambientes que promovam sua paz interior e bem-estar, longe de ruídos ou tensões.",
        "O lar e a família serão seu porto seguro, Câncer. Invista tempo e energia nessas relações e no seu espaço pessoal, pois eles são a base que nutre sua alma e te dá a força necessária para enfrentar o mundo, recarregando suas energias.",
        "Não se deixe levar por melindres ou desentendimentos pequenos, Câncer. Sua força reside na sua imensa capacidade de amar, nutrir e cuidar dos outros. Concentre-se em espalhar compaixão e afeto, construindo pontes em vez de muros.",
        "Um momento de introspecção profunda pode revelar respostas importantes para seus sentimentos e dilemas internos, Câncer. Permita-se essa pausa para se reconectar com sua essência e encontrar clareza emocional, ouvindo a voz do seu coração.",
        "Sua intuição está forte e clara, Câncer. Confie plenamente nela ao tomar decisões importantes hoje, especialmente aquelas que envolvem pessoas e relações. Seu sexto sentido é um guia confiável que raramente falha.",
        "Abrace a sua vulnerabilidade, Câncer. Expressar seus sentimentos de forma autêntica não é fraqueza, mas sim uma demonstração de força que pode aprofundar seus laços com quem você ama e confia.",
        "Cuidar do outro é uma parte intrínseca de você, mas lembre-se de cuidar de si mesmo também. Recarregue suas energias para poder continuar oferecendo seu apoio com plenitude.",
        "Um reencontro com familiares ou amigos de longa data pode trazer conforto e alegria. Reviva memórias, compartilhe histórias e fortaleça os laços afetivos que tanto valoriza.",
        "Câncer, seu lar é seu santuário. Dedique-se a torná-lo ainda mais acolhedor e seguro. Pequenas mudanças ou um tempo dedicado à organização podem trazer grande paz interior.",
        "Evite pessoas ou ambientes que drenam sua energia emocional. Sua sensibilidade é um dom, mas precisa ser protegida para que você não se sinta sobrecarregado pelas emoções alheias.",
        "Um ato de bondade para alguém em necessidade trará grande satisfação ao seu coração hoje. Sua compaixão é uma luz que ilumina o caminho dos outros e o seu próprio.",
        "Sua memória é poderosa, Câncer. Use-a para revisitar experiências passadas e aprender com elas, transformando o que foi em sabedoria para o presente e o futuro.",
        "Câncer, um projeto criativo, especialmente algo relacionado à casa ou à família, pode florescer hoje. Deixe sua imaginação fluir e crie algo que traga beleza e emoção ao seu redor.",
        "A segurança emocional é vital para você. Busque atividades ou pessoas que lhe proporcionem essa sensação de pertencimento e proteção, nutrindo seu espírito com afeto.",
        "Sua lealdade é um pilar para quem está ao seu redor. Mantenha-se firme em seus compromissos e demonstre seu apoio incondicional àqueles que contam com você.",
        "Um momento de quietude junto à água, seja um rio, um lago ou até mesmo um banho relaxante, pode ser terapeuticamente rejuvenescedor para a sua alma sensível.",
        "Câncer, sua capacidade de perdoar é uma força transformadora. Liberte-se de ressentimentos passados para que possa abraçar o presente com mais leveza e esperança.",
        "Priorize suas necessidades emocionais. É importante que você se dê o mesmo carinho e atenção que oferece aos outros, praticando o autocuidado de forma consciente.",
        "A comunicação de seus sentimentos mais profundos pode ser um desafio, mas hoje, tente expressar-se com mais abertura. A honestidade emocional fortalecerá seus laços.",
        "Câncer, um sonho recorrente ou um pressentimento pode conter uma mensagem importante do seu inconsciente. Preste atenção aos sinais e busque entender seu significado.",
        "Um dia para se reconectar com suas raízes e sua ancestralidade. Pesquisar sobre sua família ou visitar lugares com significado histórico pode trazer um senso de pertencimento.",
        "Sua empatia é um superpoder. Use-a para compreender as dores e alegrias dos outros, oferecendo um ombro amigo e um conselho genuíno quando necessário.",
        "Câncer, não tenha medo de pedir ajuda quando precisar. Permita que aqueles que te amam também cuidem de você, pois a troca de apoio é essencial nas relações.",
        "Um jantar em família ou uma noite de filmes em casa pode ser o programa perfeito para hoje. A simplicidade e o aconchego são seus maiores prazeres.",
        "Sua sensibilidade é um farol que te guia. Confie nela para discernir situações e pessoas, protegendo seu coração de energias negativas.",
        "Câncer, o passado pode trazer nostalgia, mas foque no presente. Use as memórias como fonte de sabedoria, mas viva o agora com plenitude e gratidão.",
        "Um gesto de carinho inesperado pode aquecer seu coração e te fazer sentir profundamente amado. Aprecie esses momentos de afeto e reciprocidade.",
        "Sua capacidade de nutrir e proteger é imensa. Direcione essa energia para seus projetos pessoais, cuidando deles com o mesmo carinho que dedica aos outros.",
        "Câncer, a fé e a espiritualidade podem ser um refúgio e uma fonte de força. Conecte-se com sua crença para encontrar paz e esperança em momentos de incerteza.",
        "Hoje é um dia para celebrar as pequenas alegrias do cotidiano. Encontre beleza na simplicidade e gratidão nas coisas que te trazem conforto e segurança."
    ],
    "leao": [
        "Brilhe intensamente hoje, Leão! Sua autoconfiança e carisma estarão em evidência, atraindo olhares e admiração por onde passar. Use essa energia para inspirar e liderar com generosidade e paixão, deixando sua marca positiva no mundo.",
        "Liderar é sua natureza, Leão. Assuma a frente de projetos ou situações que demandam direção e coragem, mas faça-o com sabedoria e generosidade, valorizando a contribuição de cada membro da sua equipe ou grupo. Seja o rei ou rainha que inspira.",
        "Cuidado com o ego inflado, Leão. Embora seu brilho seja natural e merecido, a humildade pode abrir mais portas e criar conexões mais verdadeiras e duradouras do que a arrogância. A modéstia fortalece sua liderança e carisma.",
        "Seja o centro das atenções, Leão, pois você nasceu para isso. No entanto, lembre-se de compartilhar os holofotes com quem merece, reconhecendo e elevando os talentos alheios. Essa magnanimidade demonstra sua verdadeira grandeza.",
        "Um projeto criativo pode florescer magnificamente hoje, Leão. Expresse sua arte, sua individualidade e sua paixão sem reservas. Sua capacidade de criar é um dom que merece ser celebrado e compartilhado com o mundo, deixando um legado de beleza.",
        "Sua generosidade é um traço marcante, Leão. Hoje, um ato de benevolência pode não só ajudar alguém, mas também aquecer seu próprio coração, reforçando sua natureza nobre e compassiva.",
        "Busque o reconhecimento que você merece, Leão. Seus esforços não devem passar despercebidos, e é justo que seu talento e dedicação sejam valorizados publicamente. Permita-se ser aplaudido.",
        "Aproveite para se divertir e descontrair. O lazer e o entretenimento são importantes para recarregar suas energias criativas e manter seu espírito vibrante e jovial.",
        "Leão, sua força de vontade é imensa. Use-a para superar obstáculos e alcançar objetivos ambiciosos. Não há desafio grande demais para sua determinação e coragem.",
        "Cuidado com o drama desnecessário. Embora você goste de atenção, foque em interações autênticas e evite situações que gerem conflitos superficiais. Sua energia é preciosa.",
        "Um flerte ou um romance pode apimentar seu dia, Leão. Sua natureza apaixonada e magnética está em alta, atraindo olhares e oportunidades para o amor e a diversão.",
        "Leão, um projeto pessoal que exige sua paixão e entusiasmo pode ganhar um novo impulso. Dedique-se com o coração e verá resultados espetaculares, dignos de sua grandiosidade.",
        "Sua liderança natural é uma inspiração. Use-a para motivar sua equipe ou amigos, incentivando-os a dar o melhor de si e a perseguir seus próprios sonhos com confiança.",
        "Mantenha-se fiel aos seus valores e princípios, Leão. Sua integridade é parte do seu carisma, e agir de acordo com sua verdade o tornará ainda mais respeitado e admirado.",
        "Um elogio sincero pode fazer seu dia, Leão. Aprecie as palavras de reconhecimento, mas lembre-se que sua maior validação vem da sua própria autoestima e autoconfiança.",
        "Hoje é um bom dia para investir em sua aparência. Sentir-se bem por fora reflete no seu brilho interior. Cuide de si com carinho e aprecie sua própria beleza.",
        "Leão, sua criatividade não tem limites. Explore novas formas de expressão artística, seja na música, na dança, na escrita ou em qualquer outra área que desperte sua alma.",
        "Aja com coragem e ousadia. Não tema dar o primeiro passo em direção a um objetivo desafiador. Sua bravura será recompensada com sucesso e reconhecimento.",
        "Um evento social ou uma festa pode ser o palco perfeito para você brilhar, Leão. Sua presença é notada e sua energia é contagiante, atraindo alegria e boas conversas.",
        "Sua autoconfiança é um ímã para o sucesso. Confie em suas habilidades e no seu potencial, pois a fé em si mesmo é o primeiro passo para realizar grandes feitos.",
        "Leão, a generosidade do seu coração é uma qualidade admirável. Compartilhe sua abundância, seja de recursos, tempo ou energia, com aqueles que precisam, sem esperar nada em troca.",
        "Um desafio pode ser uma oportunidade disfarçada para você mostrar sua força. Aceite-o com determinação e transforme-o em um palco para sua superação e vitória.",
        "Sua aura real inspira respeito. Mantenha a postura e a dignidade em todas as situações, transmitindo segurança e confiança para quem está ao seu redor.",
        "Leão, um projeto de caridade ou voluntariado pode trazer uma satisfação profunda. Usar seu brilho para uma causa maior é uma forma poderosa de deixar um impacto positivo no mundo.",
        "A paixão em tudo o que você faz é sua marca registrada. Aplique essa intensidade em seus relacionamentos, no trabalho e nos seus hobbies, vivendo cada momento com plenitude.",
        "Leão, sua capacidade de inspirar e motivar os outros é um dom. Use-o para elevar o moral da sua equipe ou grupo, impulsionando-os a alcançar resultados extraordinários.",
        "Um dia para se conectar com sua criança interior, Leão. Permita-se a brincadeira, a espontaneidade e a alegria pura, resgatando a leveza e a criatividade.",
        "Sua visão é ampla e grandiosa. Não se limite a pequenos objetivos; sonhe alto e trabalhe com paixão para construir o império que você visualiza.",
        "Leão, sua honestidade e integridade são admiráveis. Mantenha-se firme em seus valores, pois eles são a base da sua reputação e do respeito que você conquista.",
        "Sua energia é contagiante, Leão. Use-a para criar um ambiente positivo e vibrante ao seu redor, espalhando otimismo e alegria por onde passar."
    ],
    "virgem": [
        "Organização e atenção aos detalhes são seus aliados hoje, Virgem! Coloque suas tarefas e ideias em ordem com precisão, pois essa disciplina trará eficiência e resultados impecáveis. Pequenos ajustes feitos com cuidado farão uma grande diferença no seu dia.",
        "Critique menos e ajude mais, Virgem. Seu serviço e sua capacidade de aprimorar são sua maior virtude. Ofereça sua assistência com gentileza e verá o impacto positivo de suas ações no ambiente ao seu redor e na vida das pessoas que você auxilia.",
        "Não se preocupe excessivamente com a perfeição absoluta, Virgem. Embora a excelência seja seu objetivo natural, o 'bom' é inimigo do 'ótimo' em alguns casos. Aceite que nem tudo precisa ser impecável para ser valioso e entregue com qualidade.",
        "Foque na sua saúde e bem-estar, Virgem. Pequenas mudanças nos seus hábitos diários, como uma alimentação mais consciente, um tempo para relaxar ou uma atividade física leve, podem trazer grandes e duradouros benefícios para sua vitalidade e equilíbrio.",
        "Sua mente analítica estará afiada como nunca hoje, Virgem. Use essa capacidade para resolver problemas complexos, organizar informações e aprimorar processos, destacando-se pela sua precisão, lógica apurada e eficiência exemplar.",
        "Um desafio no trabalho pode ser uma oportunidade para você brilhar, Virgem. Aborde-o com sua metodologia habitual e atenção aos detalhes, e você encontrará uma solução prática e eficaz que impressionará a todos.",
        "Revise seus planos com atenção, Virgem. Os detalhes fazem toda a diferença, e sua capacidade de identificar falhas ou oportunidades de melhoria garantirá que seus projetos sejam bem-sucedidos e sem surpresas indesejadas.",
        "Virgem, dedique-se a uma tarefa que exija foco e precisão. Seja um relatório, um estudo ou um trabalho manual, sua concentração será alta hoje, permitindo que você execute com maestria e perfeição.",
        "Um bom livro ou um curso de aprimoramento pode expandir seus conhecimentos, Virgem. Sua sede por aprender e otimizar processos é constante; aproveite para absorver novas informações e habilidades úteis.",
        "Sua disciplina é admirável, Virgem. Mantenha o foco em seus objetivos, dividindo-os em etapas menores e gerenciáveis. Sua persistência metódica é a chave para o sucesso em qualquer área da vida.",
        "Evite a autocrítica excessiva, Virgem. Seja gentil consigo mesmo e reconheça seus próprios esforços e conquistas. Ninguém é perfeito, e sua dedicação já é um grande mérito.",
        "Um momento de organização em seu espaço pessoal, como seu guarda-roupa ou sua mesa de trabalho, pode trazer uma sensação de paz e controle. A ordem externa reflete na clareza mental.",
        "Virgem, sua capacidade de resolver problemas práticos é um dom. Ofereça sua ajuda a quem precisa de um conselho objetivo ou de uma solução lógica para uma situação complicada.",
        "Aproveite para cuidar da sua rotina de bem-estar. Pequenas hábitos saudáveis, como beber mais água ou fazer alongamentos, podem melhorar significativamente sua qualidade de vida no longo prazo.",
        "Sua natureza prestativa é uma qualidade valiosa, Virgem. Esteja aberto a auxiliar os outros, mas lembre-se de estabelecer limites para não se sobrecarregar com as demandas alheias.",
        "Um diálogo claro e direto pode evitar mal-entendidos. Sua comunicação precisa ser precisa para que suas intenções e conselhos sejam bem compreendidos pelas pessoas ao seu redor.",
        "Virgem, a simplicidade pode ser a chave para a solução de um problema complexo. Não complique o que pode ser simples; sua mente prática encontra a essência das coisas.",
        "Sua atenção aos detalhes também se estende às pessoas. Observe o que os outros precisam e ofereça apoio de forma discreta e eficiente, mostrando sua empatia através de atos.",
        "Um dia para se dedicar a um hobby que exija concentração e habilidade manual, como tricô, marcenaria ou montar quebra-cabeças. Isso relaxará sua mente ativa e trará satisfação.",
        "Virgem, sua capacidade de analisar informações e discernir o essencial do secundário será crucial hoje. Use essa habilidade para tomar decisões informadas e eficazes.",
        "Reavalie seus hábitos e rotinas. Pequenos ajustes podem otimizar seu tempo e energia, tornando sua vida mais produtiva e menos estressante. Busque a eficiência contínua.",
        "Sua paciência com processos e detalhes é uma virtude que poucos possuem. Aplique essa paciência em seus projetos, garantindo que cada etapa seja executada com a máxima qualidade.",
        "Virgem, um momento de contato com a natureza ou com animais pode ser muito terapêutico para você. Permita-se relaxar e desconectar da agitação, encontrando serenidade.",
        "Aprecie a beleza nas coisas simples e na ordem do universo. Sua alma virginiana se nutre da perfeição dos sistemas naturais e da organização intrínseca das coisas.",
        "Sua humildade é uma força silenciosa. Embora você seja extremamente competente, prefere o trabalho bem feito ao reconhecimento ostensivo, e isso é admirável.",
        "Virgem, um desafio intelectual pode ser muito estimulante. Envolva-se em discussões que exigem raciocínio lógico e análise, e você se sentirá realizado.",
        "A rotina, para você, não é um fardo, mas uma ferramenta para aprimoramento. Use-a para estabelecer hábitos saudáveis e construir um dia a dia mais equilibrado e produtivo.",
        "Virgem, sua capacidade de servir e ser útil é uma de suas maiores alegrias. Encontre maneiras de contribuir positivamente para a vida das pessoas ao seu redor hoje.",
        "Não se prenda ao passado ou a erros já cometidos. Olhe para frente, aprenda com as experiências e concentre-se em construir um futuro mais eficiente e harmonioso.",
        "Virgem, sua sabedoria reside na sua capacidade de observar e analisar. Confie em seus julgamentos baseados em fatos e detalhes, pois eles são precisos e confiáveis."
    ],
    "libra": [
        "Busque o equilíbrio e a harmonia em todas as suas relações hoje, Libra! A diplomacia e a capacidade de ver todos os lados de uma questão são suas ferramentas mais poderosas para manter a paz e a justiça ao seu redor, promovendo acordos.",
        "Uma decisão importante pode surgir hoje, Libra. Pondere cuidadosamente todos os lados, buscando a equidade e o consenso, antes de escolher. Sua capacidade de ponderação levará à melhor solução para todos os envolvidos, com elegância.",
        "Não fuja do confronto quando necessário, Libra, mas sempre aborde-o com elegância e justiça. Sua habilidade de dialogar e negociar pode transformar desavenças em acordos mutuamente benéficos, sem perder a serenidade.",
        "Invista em beleza e estética ao seu redor, Libra. Isso nutre sua alma e eleva seu espírito. Cerque-se de arte, boa música e ambientes agradáveis para cultivar a serenidade e a inspiração, transformando seu espaço em um santuário.",
        "Sua sociabilidade estará em alta, Libra. Conecte-se com pessoas que elevam seu espírito, troque ideias e participe de eventos sociais. Novas amizades ou parcerias interessantes podem surgir dessas interações, enriquecendo sua vida social e profissional.",
        "Um convite para um evento social ou uma reunião pode ser muito divertido e produtivo. Permita-se socializar, pois sua presença é apreciada e novas conexões podem surgir, expandindo seu círculo de amizades.",
        "Sua capacidade de mediação será valiosa hoje, Libra. Ajude a resolver conflitos, atuando como um pacificador e encontrando pontos em comum entre as partes. Sua imparcialidade é um dom.",
        "Aprecie a beleza em todas as suas formas, Libra, seja na arte, na natureza ou nas pessoas ao seu redor. A estética é essencial para o seu bem-estar, e hoje é um dia para se inspirar.",
        "Um diálogo aberto pode fortalecer um relacionamento importante. Não tenha medo de expressar sua opinião, mesmo que seja diferente, desde que o faça com gentileza e respeito.",
        "Libra, um novo projeto criativo ou artístico pode te trazer grande satisfação. Mergulhe em atividades que estimulem sua sensibilidade e seu bom gosto, expressando sua essência harmônica.",
        "A justiça é um valor fundamental para você. Lute pelo que acredita ser certo, defendendo os mais fracos e buscando a equidade em todas as situações, com sua elegância característica.",
        "Sua indecisão pode surgir, Libra. Ao invés de se prender a ela, confie em sua intuição para dar o próximo passo. Nem sempre é preciso ter todas as respostas para seguir em frente.",
        "Um momento de relaxamento e autocuidado pode restaurar seu equilíbrio interior. Um spa, um banho demorado ou uma massagem são ideais para renovar suas energias.",
        "Libra, sua capacidade de formar parcerias é notável. Colabore com outras pessoas em projetos, pois a união de forças pode trazer resultados mais ricos e completos.",
        "Mantenha a mente aberta para novas perspectivas. Ouvir diferentes pontos de vista pode enriquecer sua própria opinião e levar a soluções mais abrangentes e justas.",
        "Sua gentileza e cortesia são características que conquistam a todos. Use-as para suavizar tensões e criar um ambiente mais agradável e acolhedor ao seu redor.",
        "Libra, um desafio que exige diplomacia pode ser uma oportunidade para você brilhar. Sua habilidade de negociar e encontrar o meio-termo será fundamental para o sucesso.",
        "Aprecie a companhia de pessoas queridas. Um jantar com amigos ou um passeio a dois pode fortalecer laços e trazer momentos de pura felicidade e conexão.",
        "Sua sensibilidade para a beleza se estende ao seu ambiente. Organize e decore seu espaço para que ele reflita a harmonia e a elegância que você tanto valoriza.",
        "Libra, não se deixe levar pela opinião dos outros a ponto de perder sua própria voz. Mantenha sua individualidade e suas convicções, mesmo buscando o consenso.",
        "Um dia para refletir sobre seus relacionamentos e o que você pode fazer para torná-los ainda mais equilibrados e satisfatórios. O crescimento mútuo é a chave.",
        "Sua elegância não está apenas na aparência, mas também na sua forma de agir e se expressar. Mantenha a graciosidade em todas as suas interações, inspirando harmonia.",
        "Libra, a comunicação é sua aliada em qualquer desafio. Expresse suas necessidades e desejos com clareza e diplomacia, garantindo que suas intenções sejam bem compreendidas.",
        "Um momento de conexão com a natureza, especialmente em ambientes belos e simétricos como um jardim bem cuidado, pode trazer paz e inspiração para sua alma.",
        "Sua capacidade de conciliar é um talento raro. Use-o para unir pessoas, resolver desentendimentos e criar um senso de cooperação e entendimento coletivo.",
        "Libra, um novo hobby ou interesse que envolva arte, moda ou design pode te trazer grande alegria. Explore sua criatividade e seu senso estético.",
        "A autoaceitação é crucial para o seu equilíbrio. Ame-se e aceite suas imperfeições, pois é na sua autenticidade que reside sua verdadeira beleza e força interior.",
        "Sua busca por justiça social pode ser mais forte hoje. Envolver-se em causas que promovem a igualdade e a equidade trará grande satisfação ao seu espírito.",
        "Libra, a parceria é fundamental para você. Valorize seus relacionamentos mais próximos, dedicando tempo e energia para nutrir esses laços e crescerem juntos.",
        "Um dia para celebrar o amor e a beleza em todas as suas formas. Permita-se ser feliz e espalhar essa energia positiva ao seu redor."
    ],
    "escorpiao": [
        "Sua intensidade estará em evidência hoje, Escorpião! Use essa força poderosa para transformar e renovar aspectos da sua vida que precisam de mudança. Mergulhe fundo para ressurgir mais forte e autêntico, liberando o que não serve mais.",
        "Mergulhe fundo em seus sentimentos e emoções, Escorpião. A autodescoberta e a compreensão de suas próprias profundezas trarão um poder imenso e uma clareza sobre seus verdadeiros desejos e motivações. Não fuja de si mesmo.",
        "Cuidado com ciúmes ou possessividade excessiva hoje, Escorpião. Lembre-se que a confiança mútua é a base de toda relação saudável e duradoura. Cultive a segurança em si mesmo para evitar armadilhas emocionais e construir laços mais sólidos.",
        "Um segredo ou uma verdade oculta pode vir à tona hoje, Escorpião. Lide com essa revelação com sabedoria, discernimento e sua habitual perspicácia, transformando o inesperado em uma oportunidade de crescimento e libertação.",
        "Sua intuição penetrante será sua bússola mais confiável hoje, Escorpião. Confie naqueles pressentimentos e na sua capacidade de ler nas entrelinhas, pois eles o guiarão por caminhos mais seguros e reveladores, protegendo-o de enganos.",
        "Sua resiliência é sua maior força. Use-a para superar desafios e transformações, pois sua capacidade de renascer das cinzas é lendária. Mantenha-se firme e persista, pois a superação está ao seu alcance.",
        "Escorpião, uma conversa profunda e honesta pode trazer cura e entendimento em um relacionamento. Não hesite em mergulhar nas emoções, pois a verdade, por mais intensa que seja, libertará vocês.",
        "Não tenha medo de enfrentar seus medos mais profundos. A superação de suas inseguranças te fortalecerá e revelará uma força interior que você talvez nem soubesse que possuía. O medo é apenas um portal.",
        "Sua paixão pode mover montanhas, Escorpião. Direcione essa energia intensa para o bem, seja em um projeto pessoal, em uma causa que você acredita ou em seus relacionamentos mais íntimos, vivendo com intensidade.",
        "Um mistério pode ser desvendado hoje. Fique atento aos sinais, às coincidências e às informações que surgem, pois sua mente investigativa é capaz de ligar os pontos e descobrir a verdade por trás das aparências.",
        "Sua capacidade de se regenerar é notável. Se algo terminou, confie que algo novo e melhor está prestes a começar. O fim é apenas um novo começo para você, Escorpião.",
        "Escorpião, um investimento ou uma parceria financeira pode exigir sua atenção. Use sua sagacidade e sua habilidade para lidar com recursos compartilhados, garantindo acordos justos e vantajosos.",
        "A intensidade das suas emoções pode ser assustadora para alguns, mas é sua marca registrada. Permita-se sentir profundamente, mas também aprenda a canalizar essa energia de forma construtiva.",
        "Sua lealdade é inabalável para aqueles em quem confia. Demonstre seu apoio incondicional aos seus entes queridos, pois eles valorizam sua presença e sua força nos momentos difíceis.",
        "Um momento de silêncio e introspecção pode ser muito benéfico para você. Desconecte-se do mundo exterior e mergulhe em suas profundezas para encontrar suas próprias respostas e verdades.",
        "Escorpião, evite manipular situações ou pessoas, mesmo que a intenção seja boa. A honestidade e a transparência construirão relações mais sólidas e duradouras, baseadas na confiança mútua.",
        "Sua capacidade de perdoar é um ato de poder. Liberte-se de ressentimentos passados, pois eles apenas pesam em sua alma. O perdão é um presente que você dá a si mesmo.",
        "Um desafio que exige sua coragem e determinação pode surgir. Aceite-o de frente, pois sua natureza guerreira está pronta para a batalha e para a vitória. Você é mais forte do que imagina.",
        "Sua sexualidade e magnetismo pessoal estão em alta. Use essa energia para aprofundar a intimidade em seus relacionamentos, expressando sua paixão de forma autêntica e saudável.",
        "Escorpião, a arte da desapego pode ser desafiadora, mas libertadora. Solte o que não te serve mais, seja um objeto, uma ideia ou um relacionamento, para abrir espaço para o novo.",
        "Um segredo compartilhado pode fortalecer um laço. Se alguém confia em você, honre essa confiança com sigilo e apoio, mostrando sua capacidade de ser um confidente leal.",
        "Sua mente investigativa não se contenta com a superfície. Mergulhe em estudos ou pesquisas que satisfaçam sua curiosidade sobre o desconhecido e o misterioso.",
        "Escorpião, a transformação é um processo contínuo na sua vida. Abrace cada mudança com coragem, pois ela te leva a um nível mais elevado de consciência e poder pessoal.",
        "Um projeto que exige sua atenção minuciosa e sua capacidade de lidar com o que está oculto pode ser bem-sucedido. Sua perspicácia é um diferencial.",
        "Sua conexão com o lado oculto da vida é profunda. Explore sua espiritualidade ou temas esotéricos, pois isso pode trazer grande entendimento e poder pessoal.",
        "Escorpião, não tema a escuridão, pois é nela que você encontra sua luz mais brilhante. Encare seus desafios internos e externos com bravura e autoconhecimento.",
        "Sua intuição pode te guiar em decisões financeiras ou de herança. Preste atenção aos seus pressentimentos em relação a investimentos ou bens compartilhados.",
        "Um momento para se reconectar com sua força interior e com seu poder pessoal. Reafirme sua capacidade de comandar sua própria vida e de criar sua realidade.",
        "Escorpião, a autenticidade é sua marca. Seja verdadeiro consigo mesmo e com os outros, mesmo que isso signifique ir contra a corrente. Sua integridade é sua maior virtude.",
        "Sua capacidade de superação é uma inspiração. Lembre-se de todas as vezes que você se reergueu e use essa memória como combustível para qualquer novo desafio que surgir hoje."
    ],
    "sagitario": [
        "Aventure-se em novas ideias e horizontes hoje, Sagitário! A liberdade é seu lema, e o universo o convida a expandir seus conhecimentos e experiências. Permita-se explorar o desconhecido com otimismo e um espírito destemido, pois grandes descobertas o aguardam.",
        "Seu otimismo e bom humor são contagiantes, Sagitário. Compartilhe sua alegria e entusiasmo com o mundo ao seu redor, inspirando outros a ver o lado positivo da vida e a perseguir seus próprios sonhos com paixão e fé. Sua luz é um farol para muitos.",
        "Cuidado com a impulsividade excessiva, Sagitário. Pense duas vezes antes de agir ou falar para evitar arrependimentos e garantir que suas aventuras sejam bem-sucedidas e sem imprevistos desnecessários. A prudência pode ser uma aliada da liberdade.",
        "Um aprendizado novo ou uma viagem mental pode expandir sua mente e seus horizontes de forma significativa hoje, Sagitário. Mergulhe em conhecimentos que te fascinam ou planeje sua próxima grande jornada, seja física ou intelectual, nutrindo sua sede de saber.",
        "Seja honesto e direto, Sagitário, pois essa é uma de suas maiores virtudes. No entanto, use sua franqueza com diplomacia e gentileza para não ferir os outros. A verdade, quando dita com compaixão, constrói pontes e fortalece relações.",
        "A sorte está ao seu lado hoje, Sagitário. Aproveite as oportunidades que surgem, pois o universo conspira a seu favor. Confie na sua intuição e no seu instinto para dar o passo certo no momento certo.",
        "Um desafio pode ser uma aventura disfarçada, Sagitário. Mergulhe de cabeça com seu entusiasmo habitual, pois você tem a capacidade de transformar qualquer obstáculo em uma emocionante jornada de superação.",
        "Sagitário, sua energia é contagiante. Use-a para motivar quem está perto, incentivando-os a perseguir seus próprios objetivos e a viver a vida com mais paixão e otimismo. Sua vibração positiva é um presente.",
        "Expanda seus horizontes e não se prenda a velhos conceitos ou limitações, Sagitário. O mundo é vasto e cheio de possibilidades, e sua mente curiosa está pronta para absorver tudo o que há de novo.",
        "Sua fé na vida e no futuro te guiará. Confie no processo, mesmo que nem tudo esteja claro. Sua crença inabalável no bem o levará a caminhos prósperos e cheios de significado.",
        "Sagitário, um reencontro com pessoas queridas pode trazer memórias agradáveis e novas ideias. Valorize esses laços, pois a troca de experiências e o afeto são essenciais para sua alma aventureira.",
        "Aprecie a beleza da natureza e recarregue suas energias, Sagitário. Um tempo ao ar livre, em contato com o vasto mundo natural, pode renovar seu espírito e trazer uma sensação de liberdade.",
        "Sua sinceridade é um trunfo, mas lembre-se da sensibilidade alheia. A honestidade é fundamental, mas a forma como ela é entregue pode fazer toda a diferença nas suas interações.",
        "Sagitário, o conhecimento é a chave para o seu crescimento pessoal e para a sua expansão. Nunca pare de aprender, de ler, de questionar e de buscar novas filosofias de vida.",
        "Um projeto ambicioso pode começar a tomar forma hoje. Sonhe alto e confie na sua capacidade de transformar grandes visões em realidade. Sua ambição é um motor poderoso.",
        "Sua espontaneidade pode abrir portas inesperadas e trazer aventuras emocionantes. Permita-se ser livre, agir por impulso (com sabedoria) e aproveitar as surpresas da vida.",
        "Sagitário, um bom humor inabalável será sua marca registrada hoje. Espalhe sorrisos e leveza, pois sua alegria é contagiante e pode iluminar o dia de muitas pessoas.",
        "Não se limite! Sua capacidade de explorar é infinita, seja em termos de viagens, estudos ou novas experiências. Quebre as barreiras e vá além do que você imagina ser possível.",
        "Um novo esporte ou atividade física pode ser um ótimo alívio para o estresse e uma forma de canalizar sua energia. Busque algo que o desafie e o faça sentir vivo e em movimento.",
        "Sagitário, confie em sua intuição para guiá-lo em decisões importantes. Aquela 'voz interior' pode ser a sabedoria do universo sussurrando o caminho certo para você.",
        "Um sorriso pode ser sua melhor arma. Use-o com sabedoria para desarmar tensões, conquistar aliados e criar um ambiente positivo ao seu redor, espalhando otimismo.",
        "Sagitário, sua visão de futuro é clara e inspiradora. Trabalhe com paixão e dedicação para torná-la realidade, passo a passo, construindo o futuro que você sonha para si e para os outros.",
        "Um dia para se conectar com a espiritualidade e a fé. Busque um significado maior para a vida, seja através da meditação, da filosofia ou da conexão com algo transcendente.",
        "A curiosidade te levará a novas descobertas e aventuras. Não pare de aprender, de perguntar e de explorar, pois cada nova informação abre um universo de possibilidades.",
        "Sua paixão pela vida é inspiradora. Compartilhe essa energia com o mundo, vivendo cada momento com entusiasmo e gratidão. Sua alegria é um presente para todos.",
        "Sagitário, sua honestidade pode ser desafiadora, mas é profundamente valorizada. Fale sua verdade com coragem e integridade, mesmo que não seja o que os outros querem ouvir.",
        "Um novo caminho ou oportunidade de carreira pode surgir. Avalie com otimismo e sua intuição aventureira, pois pode ser o momento de uma grande mudança para o crescimento.",
        "Sagitário, a liberdade de expressão é crucial para você. Encontre maneiras de manifestar suas ideias e opiniões de forma autêntica, defendendo o que você acredita ser justo.",
        "Seu espírito de busca incessante o levará a lugares e conhecimentos incríveis. Permita-se ser um eterno aprendiz e um explorador do desconhecido.",
        "Hoje é um dia para celebrar a vida e as maravilhas do mundo. Mantenha seu espírito leve, seu coração aberto e sua mente pronta para novas aventuras, Sagitário."
    ],
    "capricornio": [
        "Foque em suas metas e responsabilidades hoje, Capricórnio! Sua disciplina e ética de trabalho inabaláveis o levarão ao sucesso duradouro e reconhecimento. Mantenha a determinação e a visão de longo prazo em mente, pois cada passo conta para sua ascensão.",
        "Seja prático e realista em suas abordagens, Capricórnio. Construa seus sonhos e projetos com bases sólidas e um planejamento cuidadoso, pois a solidez é a chave para a longevidade de suas conquistas e para evitar surpresas no futuro.",
        "Não se sobrecarregue com trabalho excessivo, Capricórnio. O equilíbrio entre suas ambições e o cuidado com seu bem-estar é fundamental para sua longevidade e felicidade. Permita-se momentos de descanso e lazer para recarregar suas energias.",
        "Sua ambição é uma virtude poderosa, Capricórnio, mas lembre-se de aproveitar a jornada e celebrar cada pequena conquista ao longo do caminho. A vida não é apenas sobre o destino, mas também sobre a trilha percorrida com dedicação.",
        "Um reconhecimento merecido pelo seu esforço e dedicação pode estar a caminho, Capricórnio. Seus talentos e sua perseverança não passam despercebidos, e o universo está pronto para recompensar seu árduo trabalho e compromisso.",
        "Capricórnio, hoje é um dia para consolidar seus ganhos e planejar os próximos passos de forma estratégica. Revise seus planos com a precisão que lhe é peculiar, garantindo um futuro financeiro e profissional ainda mais seguro.",
        "Sua paciência e persistência serão recompensadas com resultados concretos. Não desista diante dos desafios, pois sua capacidade de continuar firme, mesmo em momentos difíceis, é sua maior aliada para o sucesso.",
        "Capricórnio, a organização da sua vida material trará uma profunda tranquilidade. Dedique-se a arrumar finanças, documentos ou o ambiente de trabalho, e sinta a paz que a ordem traz à sua mente.",
        "Um conselho de alguém mais experiente ou uma figura de autoridade pode ser muito útil hoje. Esteja aberto a receber orientações, pois a sabedoria de outros pode iluminar seu caminho e evitar tropeços.",
        "Capricórnio, celebre suas pequenas vitórias com o mesmo fervor que celebra as grandes. Cada passo conta, cada objetivo menor alcançado é um tijolo na construção do seu grande sucesso.",
        "Aproveite a solitude para refletir sobre seus objetivos e recalibrar suas estratégias, Capricórnio. Esse tempo consigo mesmo é essencial para focar e garantir que seus planos estejam alinhados com suas ambições.",
        "Sua capacidade de liderança será testada. Assuma o controle com sabedoria, justiça e firmeza, inspirando confiança e respeito em sua equipe ou grupo. Sua postura séria traz resultados.",
        "Capricórnio, não tema desafios. Eles são degraus para o seu crescimento e para provar sua força. Encare-os com sua determinação habitual, pois você tem todas as ferramentas para superá-los.",
        "Um investimento de longo prazo pode trazer bons frutos. Pense no futuro com pragmatismo e prudência, buscando oportunidades que ofereçam segurança e crescimento sustentável para sua vida.",
        "Sua ética de trabalho é admirável, Capricórnio. Continue focado e determinado em seus afazeres, pois sua dedicação é a base da sua reputação e do seu sucesso em qualquer área.",
        "Capricórnio, priorize sua saúde mental e emocional. Um tempo para si, longe das responsabilidades, é essencial para recarregar as energias e manter a clareza para tomar decisões.",
        "A segurança financeira é importante, mas lembre-se que ela não é a única coisa na vida. Valorize também suas relações, seus momentos de lazer e seu bem-estar geral.",
        "Capricórnio, sua maturidade e senso de responsabilidade são um exemplo para os outros. As pessoas confiam em você para liderar e para tomar decisões sensatas, honre essa confiança.",
        "Um projeto em grupo pode exigir sua liderança e organização. Seja justo e firme, garantindo que todos contribuam e que o objetivo comum seja alcançado com eficiência.",
        "Planeje com antecedência para evitar imprevistos. Sua organização é uma força que te poupa de dores de cabeça e te permite agir com calma e assertividade em qualquer situação.",
        "Capricórnio, não se esqueça de comemorar suas conquistas, por menores que sejam. Reconhecer seu próprio valor e seus esforços é tão importante quanto alcançá-los.",
        "A disciplina que você impõe a si mesmo é a chave para a sua realização e para a construção da vida que você deseja. Mantenha-se firme em seus princípios e hábitos.",
        "Capricórnio, uma oportunidade de crescimento profissional pode surgir. Esteja atento e avalie-a com a seriedade que lhe é peculiar, pois pode ser um marco importante na sua carreira.",
        "Sua lealdade é um valor inestimável. Cultive suas amizades e parcerias com dedicação, pois elas são fontes de apoio e estabilidade em sua jornada, especialmente em tempos de dificuldade.",
        "Um pequeno avanço hoje é um grande passo para o amanhã, Capricórnio. Não subestime o poder dos pequenos progressos; eles se somam para formar grandes resultados ao longo do tempo.",
        "Sua capacidade de adaptação será importante. Esteja aberto a mudanças e a novas formas de fazer as coisas, mesmo que prefira a estabilidade. A flexibilidade pode trazer vantagens.",
        "Capricórnio, a paciência é uma virtude que você domina. Use-a a seu favor em negociações, no trabalho e na vida pessoal, esperando o momento certo para agir com precisão.",
        "Um diálogo franco e objetivo pode resolver mal-entendidos. Fale com clareza e sem rodeios, garantindo que suas intenções sejam bem compreendidas e que a comunicação seja eficaz.",
        "Capricórnio, seu senso de dever é admirável. Cumpra suas promessas e compromissos com integridade, construindo uma reputação sólida e confiável que o acompanhará por toda a vida.",
        "Aproveite para reavaliar seus planos e fazer ajustes necessários. Sua capacidade de análise crítica garantirá que você esteja sempre no caminho mais eficiente para seus objetivos."
    ],
    "aquario": [
        "Inove e seja original hoje, Aquário! Sua mente brilhante e visionária pode trazer grandes ideias e soluções revolucionárias para problemas antigos. Não tenha medo de pensar fora da caixa e desafiar o status quo, pois sua singularidade é seu maior trunfo.",
        "Conecte-se com sua tribo, Aquário. Seus amigos e grupos de afinidade são uma fonte inestimável de inspiração, apoio e troca de ideias. Juntos, vocês podem mover montanhas e construir um futuro melhor, pautado pela colaboração e ideais elevados.",
        "Cuidado com o distanciamento emocional, Aquário. Permita-se sentir e expressar suas emoções, pois a vulnerabilidade pode fortalecer laços e trazer mais autenticidade para suas relações pessoais. Conecte-se com seu próprio coração para se conectar com os outros.",
        "Um projeto humanitário ou uma causa social pode despertar seu interesse e paixão de forma intensa hoje, Aquário. Use sua energia para contribuir com algo maior do que você, deixando um legado de impacto positivo e inspirando a mudança coletiva.",
        "Sua visão de futuro é única e à frente do seu tempo, Aquário. Compartilhe-a com o mundo sem receios, pois suas ideias progressistas têm o poder de inspirar mudanças significativas e abrir novos caminhos para a coletividade, pavimentando o amanhã.",
        "Aquário, um debate saudável e estimulante pode aguçar sua mente e trazer novas perspectivas. Participe ativamente, expondo suas ideias de forma lógica e ouvindo as dos outros com mente aberta e curiosidade.",
        "Sua independência é um valor primordial. Lute por suas causas e por sua liberdade de ser quem você é, mas lembre-se que a colaboração pode amplificar sua voz e seus resultados.",
        "Aquário, um novo grupo ou comunidade pode te acolher e inspirar. Busque pessoas que compartilhem seus ideais e visões, pois a troca de ideias e a sinergia podem gerar grandes inovações.",
        "Pense fora da caixa. Suas ideias são inovadoras e podem ser a chave para soluções inesperadas. Não se prenda a padrões antigos; sua originalidade é sua força motriz.",
        "Aquário, o futuro está em suas mãos. Faça a diferença hoje, por meio de suas ações e ideais. Cada pequeno passo em direção a um mundo mais justo e inovador conta.",
        "Sua originalidade é seu superpoder. Use-a para se destacar e para expressar sua individualidade sem medo. Abrace sua singularidade, pois é nela que reside sua verdadeira força.",
        "Aquário, um convite inesperado pode trazer uma aventura social ou uma nova experiência. Permita-se sair da rotina e explorar o desconhecido com a mente aberta e curiosa.",
        "A mente aberta te levará a descobertas incríveis. Explore sem limites, questione o que é dado como certo e busque o conhecimento em todas as suas formas, expandindo sua consciência.",
        "Aquário, não se prenda a convenções ou expectativas sociais. Seu caminho é único, e sua autenticidade é sua maior beleza. Siga seu próprio ritmo e seus próprios princípios.",
        "Um projeto colaborativo pode ser muito gratificante hoje. Compartilhe suas ideias e trabalhe em equipe, pois a união de mentes diversas pode levar a resultados surpreendentes e inovadores.",
        "Aquário, liberte-se de preconceitos e abrace a diversidade em todas as suas formas. A riqueza das diferenças é o que impulsiona o progresso e o entendimento humano.",
        "Sua intuição social é apurada. Saiba quem vale a pena ter por perto e quem pode trazer energias negativas. Selecione suas companhias com sabedoria, buscando conexões genuínas.",
        "Aquário, um ideal pode se tornar realidade com sua dedicação e a colaboração de outros. Foque em uma causa que te move e trabalhe incansavelmente por ela, inspirando a mudança.",
        "Compartilhe seus pensamentos e inspire os outros com suas ideias. Sua capacidade de articular visões progressistas pode acender a chama da mudança em muitas pessoas.",
        "Sua mente é um campo fértil para a inovação. Deixe-a fluir livremente, sem restrições, pois as melhores ideias surgem quando você se permite pensar sem limites ou medos.",
        "Aquário, um momento de introspecção pode trazer clareza para seus ideais e valores. Reconecte-se com sua missão pessoal e reforce seu propósito no mundo.",
        "Sua capacidade de ver o todo e de conectar diferentes pontos de vista é uma vantagem. Use-a para ajudar a resolver problemas complexos e a unir forças em prol de um objetivo comum.",
        "Aquário, um pequeno ato de bondade pode ter um grande impacto na vida de alguém. Sua natureza humanitária se manifesta em gestos simples, mas poderosos, de compaixão.",
        "Não tenha medo de ser diferente, Aquário. Sua singularidade é sua beleza e sua força. Abrace o que te torna único e use isso para fazer a diferença no mundo.",
        "Aquário, uma conversa profunda com um amigo pode fortalecer seus laços e trazer insights importantes. Valorize a troca intelectual e emocional com aqueles que você confia.",
        "A tecnologia pode ser sua aliada hoje. Explore novas ferramentas, aplicativos ou softwares que possam otimizar seus processos ou te conectar com novas comunidades e informações.",
        "Aquário, seu espírito livre te guiará para novas experiências e oportunidades de aprendizado. Não se prenda a convenções; siga o chamado da sua alma aventureira.",
        "Reavalie suas prioridades e ajuste seus planos conforme necessário. Sua capacidade de se adaptar e de inovar é crucial para manter-se alinhado com as mudanças do mundo.",
        "Aquário, sua inteligência é um farol. Use-a para iluminar o caminho, para questionar o estabelecido e para propor soluções criativas que beneficiem a todos.",
        "Hoje é um dia para quebrar padrões e buscar a liberdade pessoal em todas as suas formas. Liberte-se de limitações autoimpostas e abrace seu verdadeiro potencial."
    ],
    "peixes": [
        "Sua sensibilidade e intuição estarão em alta hoje, Peixes! Confie plenamente nos seus pressentimentos e na sua voz interior, pois eles são guias confiáveis para navegar pelas águas profundas da vida. Siga sua intuição sem hesitar.",
        "Dedique-se a atividades criativas ou espirituais, Peixes. Nutra sua alma com arte, música, meditação ou qualquer prática que te conecte com o divino e com sua própria essência. É tempo de reabastecer suas energias e encontrar paz.",
        "Cuidado para não se iludir ou se perder em fantasias excessivas, Peixes. Mantenha os pés no chão, mesmo sonhando alto. O equilíbrio entre o ideal e o real é fundamental para transformar sonhos em realidade de forma saudável e concreta.",
        "Um ato de compaixão e altruísmo pode trazer grande satisfação e plenitude para você hoje, Peixes. Sua empatia é um dom; use-o para ajudar quem precisa, e a recompensa virá em forma de paz interior e um senso de propósito renovado.",
        "Sonhe grande, Peixes, mas dê pequenos e conscientes passos para transformar seus sonhos em realidade. A jornada é construída com intenção e ação, e cada pequeno avanço te aproxima mais do seu ideal, por mais distante que pareça.",
        "Peixes, a música e a arte podem ser refúgios e fontes de inspiração para a sua alma hoje. Permita-se mergulhar nessas expressões, pois elas falam diretamente ao seu coração e liberam sua criatividade.",
        "Sua empatia é um superpoder. Use-a para compreender as dores e alegrias dos outros, oferecendo um ombro amigo e um conselho genuíno quando necessário, tornando-se um porto seguro para quem busca conforto.",
        "Peixes, um momento de solidão e introspecção pode trazer clareza para seus pensamentos e emoções. Desconecte-se do mundo exterior para se reconectar com sua sabedoria interna e suas verdades mais profundas.",
        "Não se deixe levar pela autocompaixão ou pela vitimização. Sua força interior é imensa e sua capacidade de superar desafios é notável. Confie na sua resiliência e no seu poder de adaptação.",
        "Peixes, confie no fluxo da vida e permita-se ser guiado pelas correntezas do destino. Nem tudo precisa ser controlado; às vezes, render-se ao processo traz mais paz e oportunidades inesperadas.",
        "Sua criatividade é ilimitada. Deixe sua imaginação te levar longe, explorando novas ideias e formas de expressão. O mundo precisa da sua visão única e da sua capacidade de sonhar.",
        "Peixes, um sonho pode conter uma mensagem importante para o seu dia. Preste atenção aos seus sonhos e intuições, pois eles podem revelar insights valiosos ou guiar seus próximos passos de forma sutil.",
        "Abrace a sua espiritualidade. Ela é uma fonte de paz, sabedoria e conexão com algo maior do que você. Explore práticas que nutram sua alma e fortaleçam sua fé no universo.",
        "Peixes, um ato de serviço aos outros pode ser muito gratificante e preenchedor. Ofereça sua ajuda de forma altruísta, pois sua felicidade está intrinsecamente ligada ao bem-estar coletivo.",
        "Sua intuição é um guia seguro e confiável. Siga-a com confiança em todas as suas decisões, especialmente aquelas que envolvem o coração e as emoções. Ela te levará ao melhor caminho.",
        "Peixes, evite ambientes negativos ou pessoas que possam drenar sua energia. Sua sensibilidade te torna suscetível a influências externas; proteja sua aura e busque companhias que te elevam.",
        "A compaixão te conecta com o universo e com a humanidade. Compartilhe seu amor e sua compreensão com o mundo, espalhando gentileza e empatia por onde quer que você vá.",
        "Peixes, um momento de meditação pode trazer clareza e tranquilidade para sua mente e coração. Silencie o ruído exterior e mergulhe em sua paz interior para encontrar respostas.",
        "Não se perca em fantasias ou ilusões que o afastem da realidade. Mantenha um pé no chão, mesmo enquanto seus pensamentos viajam para mundos distantes. O equilíbrio é crucial.",
        "Peixes, sua capacidade de perdoar é uma força transformadora e libertadora. Liberte-se de ressentimentos passados, pois o perdão, acima de tudo, é um presente que você dá a si mesmo.",
        "Um reencontro inesperado pode ser significativo hoje, trazendo novas perspectivas ou fechando ciclos de forma inesperada. Esteja aberto às surpresas que o destino pode te trazer.",
        "Peixes, a arte de se doar é sua maior virtude. Ofereça ajuda, ouça com o coração e estenda a mão para quem precisa, pois sua generosidade é um farol de esperança para muitos.",
        "Seus sentimentos são válidos e merecem ser expressos. Permita-se senti-los e processá-los sem julgamento, pois a aceitação emocional é o primeiro passo para a cura e o crescimento.",
        "Peixes, um novo hobby criativo, como pintura, escrita de poemas ou aprender um instrumento, pode trazer muita alegria e relaxamento para sua alma artística e sonhadora.",
        "Confie no processo da vida. Tudo acontece no seu devido tempo, e a paciência é uma virtude que te ajudará a navegar por incertezas, sabendo que o universo está trabalhando a seu favor.",
        "Peixes, um momento de silêncio e paz pode ser um bálsamo para sua alma. Busque a quietude, seja na natureza ou em seu próprio lar, para recarregar suas energias e encontrar serenidade.",
        "Sua sensibilidade é um dom que te permite compreender o mundo em um nível mais profundo. Use-a para se conectar com a beleza e a complexidade da vida, transformando dor em compaixão.",
        "Peixes, não tenha medo de expressar sua gentileza e afeto. Sua natureza carinhosa é um presente para o mundo, e seus gestos de amor podem aquecer o coração de muitos.",
        "Aprecie a beleza das pequenas coisas e encontre a magia no dia a dia. A vida está cheia de maravilhas, e sua alma sonhadora é capaz de percebê-las onde outros não veem.",
        "Peixes, hoje é um dia para se reconectar com seus sonhos e aspirações mais profundas. Permita-se sonhar sem limites, pois é nos seus sonhos que residem os mapas para o seu futuro."
    ]
};


function getFormattedDateAndDay() {
    const date = new Date();
    const dayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    const day = dayNames[date.getDay()];
    const formattedDate = date.toLocaleDateString('pt-BR');
    return { date: formattedDate, day: day };
}

async function getHoroscope(signInput) {
    try {
        const signMap = {
            'aries': 'aries', 'áries': 'aries',
            'touro': 'touro',
            'gemeos': 'gemeos', 'gêmeos': 'gemeos',
            'cancer': 'cancer', 'câncer': 'cancer',
            'leao': 'leao', 'leão': 'leao',
            'virgem': 'virgem',
            'libra': 'libra',
            'escorpiao': 'escorpiao', 'escorpião': 'escorpiao',
            'sagitario': 'sagitario', 'sagitário': 'sagitario',
            'capricornio': 'capricornio', 'capricórnio': 'capricornio',
            'aquario': 'aquario', 'aquário': 'aquario',
            'peixes': 'peixes'
        };

        const signNormalized = signInput.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const signKey = signMap[signNormalized];

        if (!signKey) {
            return `❌ Signo não reconhecido. Use: Áries, Touro, Gêmeos, etc.`;
        }

        const resumo = SIGNOS_RESUMO_FIXO[signKey];
        const frases = HOROSCOPO_FAKE_DATA[signKey];
        const { date: currentDate, day: currentDay } = getFormattedDateAndDay();
        const capitalizedSignName = signKey.charAt(0).toUpperCase() + signKey.slice(1);
        const signEmoji = SIGNOS_EMOJIS[signKey];

        const randomIndex = Math.floor(Math.random() * frases.length);
        const selectedPhrase = frases[randomIndex];

        const message =
            `${signEmoji} *Signo de ${capitalizedSignName}* ${signEmoji}\n` +
            `_${currentDay}, ${currentDate}_\n\n` +
            `🔹 *Elemento:* ${resumo.elemento}\n` +
            `🔹 *Período:* ${resumo.periodo}\n` +
            `🔹 *Planeta Regente:* ${resumo.regente}\n\n` +
            `🔮 *Previsão do Dia:* \n${selectedPhrase}\n\n` +
            `✨ _Lembre-se: O horóscopo é uma ferramenta de reflexão._`;

        return message;

    } catch (error) {
        console.error('[OWNER BOT] ❌ Erro:', error.message);
        return `Desculpe, ocorreu um erro ao gerar o horóscopo.`;
    }
}

function detectHoroscopeRequest(text) {
    const msgNormalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    const keywords = ['horoscopo', 'signo', 'previsao'];
    const hasKeyword = keywords.some(key => msgNormalized.includes(key));

    if (!hasKeyword) return null;

    const signsMap = {
        "aries": "aries", "touro": "touro", "gemeos": "gemeos", "cancer": "cancer",
        "leao": "leao", "virgem": "virgem", "libra": "libra", "escorpiao": "escorpiao",
        "sagitario": "sagitario", "capricornio": "capricornio", "aquario": "aquario", "peixes": "peixes"
    };

    for (const [searchName, internalKey] of Object.entries(signsMap)) {
        if (msgNormalized.includes(searchName)) {
            return internalKey;
        }
    }
    
    return null;
}

async function handleOwnerIncomingMessage(msg, sessionId, sock) {
    try {
        console.log('\n' + '='.repeat(70));
        console.log('[OWNER BOT] 📨 NOVA MENSAGEM RECEBIDA');
        console.log('='.repeat(70));
        
        if (!msg) {
            console.log('[OWNER BOT] ❌ Mensagem inválida');
            return;
        }
        
        const remoteJid = msg.key?.remoteJid;
        const isGroup = remoteJid?.includes('@g.us');
        const fromMe = msg.key?.fromMe;
        const senderLID = msg.key?.participant || msg.participant;
        
        console.log('[OWNER BOT] 🔍 fromMe:', fromMe);
        console.log('[OWNER BOT] 🔍 senderLID:', senderLID);
        console.log('[OWNER BOT] 🔍 isGroup:', isGroup);
        
        if (fromMe && isGroup && senderLID) {
            console.log('[OWNER BOT] 🤖 BOT ENVIOU MENSAGEM NO GRUPO!');
            console.log('[OWNER BOT] 🔑 LID do bot neste grupo:', senderLID);
            
            const savedLID = await botIdentification.getSavedBotLID(remoteJid);
            
            if (!savedLID || savedLID !== senderLID) {
                console.log('[OWNER BOT] 💾 SALVANDO LID:', senderLID);
                await botIdentification.saveBotLID(remoteJid, senderLID);
            } else {
                console.log('[OWNER BOT] ✅ LID já está salvo corretamente');
            }
            
            return;
        }
        
        if (fromMe) {
            console.log('[OWNER BOT] 👤 Bot/Owner enviou mensagem');
            if (!isGroup) {
                const phoneNumber = remoteJid.split('@')[0];
                processOwnerMessage(phoneNumber);
            }
            return;
        }
        
        console.log('[OWNER BOT] ✅ Mensagem de cliente');
        console.log('[OWNER BOT] 📱 RemoteJid:', remoteJid, isGroup ? '(GRUPO)' : '(PRIVADO)');
        
        if (!remoteJid || remoteJid === 'status@broadcast') {
            console.log('[OWNER BOT] ⏭️ Ignorando broadcast');
            return;
        }
        
        let groupName = null;
        let isMentioned = false;
        let senderJid = null;
        let senderName = null;
        let shouldProcess = false;
        
        if (isGroup) {
            try {
                const metadata = await sock.groupMetadata(remoteJid);
                groupName = metadata?.subject || remoteJid;
                console.log('[OWNER BOT] 👥 Grupo:', groupName);
            } catch (e) {
                groupName = remoteJid;
                console.error('[OWNER BOT] ⚠️ Erro ao obter nome do grupo:', e.message);
            }

            let savedBotLID = await botIdentification.getSavedBotLID(remoteJid);
            
            const mentions = extractMentions(msg);
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const replyParticipant = contextInfo?.participant || null;
            
            if (!savedBotLID) {
                console.log('[OWNER BOT] ⚠️ LID não encontrado');
            } else {
                console.log('[OWNER BOT] ✅ LID salvo:', savedBotLID);
            }
            
            let text = '';
            if (msg.message?.conversation) {
                text = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                text = msg.message.extendedTextMessage.text;
            } else if (msg.message?.imageMessage?.caption) {
                text = msg.message.imageMessage.caption;
            }
            
            if (text === '/diary stats') {
                const stats = moltbookDiary.getStats();
                await sock.sendMessage(remoteJid, {
                    text: `📊 **Estatísticas do Diário Moltbook:**\n\n` +
                        `• Interações registradas: ${stats.totalInteractions}\n` +
                        `• Pode postar: ${stats.canPost ? 'Sim ✅' : 'Não ❌'}\n` +
                        `• Minutos até próximo post: ${stats.minutesUntilCanPost}\n` +
                        `• Último post: ${stats.lastPostTime}`,
                    quoted: msg
                });
                return;
            }

            if (text === '/diary post') {
                const success = await moltbookDiary.forcePost();
                await sock.sendMessage(remoteJid, {
                    text: success ? '✅ Post de diário criado no Moltbook!' : '❌ Não foi possível postar (aguarde cooldown ou adicione mais interações)',
                    quoted: msg
                });
                return;
            }
            
            console.log('[OWNER BOT] 🔍 Debug:');
            console.log('   - Texto:', text);
            console.log('   - Menções:', mentions);
            console.log('   - Reply:', replyParticipant);
            console.log('   - LID Salvo:', savedBotLID || 'Nenhum');
            console.log('   - Tem Imagem:', !!msg.message?.imageMessage);
            
            isMentioned = await botIdentification.isBotMentionedOrReplied(
                remoteJid,
                mentions,
                replyParticipant,
                sock
            );
            
            console.log('[OWNER BOT] 👥 Bot mencionado?', isMentioned);
            
            if (!isMentioned) {
                console.log('[OWNER BOT] 🚫 Bot não foi mencionado - IGNORANDO');
                return;
            }
            
            const groupAIEnabled = await isGroupAIEnabled(remoteJid);
            if (!groupAIEnabled) {
                console.log('[OWNER BOT] 🚫 IA desativada neste grupo');
                return;
            }
            
            senderJid = msg.key.participant || msg.participant;
            senderName = await getUserName(sock, remoteJid, senderJid);
            
            shouldProcess = true;
        } else {
            shouldProcess = true;
        }
        
        if (!shouldProcess) {
            console.log('[OWNER BOT] ⏭️ Mensagem não será processada');
            return;
        }
        
        let text = '';
        if (msg.message?.conversation) {
            text = msg.message.conversation;
        } else if (msg.message?.extendedTextMessage?.text) {
            text = msg.message.extendedTextMessage.text;
        } else if (msg.message?.imageMessage?.caption) {
            text = msg.message.imageMessage.caption;
        }
        
        const hasImage = !!msg.message?.imageMessage;
        const wantSticker = text.toLowerCase().includes('criar figurinha') || 
                           text.toLowerCase().includes('fazer figurinha') ||
                           text.toLowerCase().includes('gerar figurinha');
        
        if (hasImage && (isMentioned || !isGroup)) {
            if (wantSticker || !text || text.trim() === '') {
                console.log('[OWNER BOT] 🖼️ DETECTADO: Imagem + Menção → Criar Figurinha');
                text = 'criar figurinha';
            }
        }
        
        if (isGroup && isMentioned) {
            text = text.replace(/@\d+/g, '').trim();
        }
        
        if (!text || text.trim() === '') {
            console.log('[OWNER BOT] ⏭️ Sem texto');
            return;
        }
        
        console.log('[OWNER BOT] ✅ PROCESSANDO');
        
        // ✅ SÓ REAGE EM GRUPOS
        if (isGroup) {
            await reactToMessage(sock, remoteJid, msg.key, '⏳');
        }
        
        const identifier = isGroup ? remoteJid : remoteJid.split('@')[0];
        const userName = senderName || (isGroup ? 'Usuário de Grupo' : remoteJid.split('@')[0]);
        
        const horoscopeSign = detectHoroscopeRequest(text);
        if (horoscopeSign) {
            console.log('[OWNER BOT] 🔮 Horóscopo detectado:', horoscopeSign);
            
            try {
                await sock.sendPresenceUpdate('composing', remoteJid);
                const horoscope = await getHoroscope(horoscopeSign);
                await sock.sendPresenceUpdate('available', remoteJid);
                
                if (isGroup) {
                    await reactToMessage(sock, remoteJid, msg.key, '🔮');
                }
                
                await sock.sendMessage(remoteJid, {
                    text: horoscope,
                    quoted: msg
                });

                registerInteraction('horoscope', `Horóscopo de ${horoscopeSign}`, userName, isGroup, groupName, 'Enviado');
                return;
            } catch (error) {
                console.error('[OWNER BOT] ❌ Erro horóscopo:', error.message);
                if (isGroup) {
                    await reactToMessage(sock, remoteJid, msg.key, '❌');
                }
                await sock.sendMessage(remoteJid, {
                    text: '❌ Erro ao buscar horóscopo',
                    quoted: msg
                });
                return;
            }
        }
        
        const mediaRequest = spiderXMedia.detectMediaRequest(text);
        
        if (mediaRequest) {
            console.log('[OWNER BOT] 🎨 Mídia detectada:', mediaRequest.type);
            
            try {
                await sock.sendPresenceUpdate('composing', remoteJid);
                
                if (mediaRequest.type === 'image') {
                    const result = await spiderXMedia.generateImage(mediaRequest.prompt);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '🖼️');
                        }
                        await sock.sendMessage(remoteJid, {
                            image: { url: result.imageUrl },
                            caption: `✨ *Imagem gerada!*\n\n📝 _${mediaRequest.prompt}_`,
                            quoted: msg
                        });
                        registerInteraction('media_request', `Imagem: ${mediaRequest.prompt}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'audio') {
                    const result = await spiderXMedia.downloadAudio(mediaRequest.search);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '🎵');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `🎵 *${result.title}*\n\n👤 ${result.channel}\n⏱️ ${Math.floor(result.duration / 60)}:${(result.duration % 60).toString().padStart(2, '0')}\n🔗 ${result.youtubeUrl}`,
                            quoted: msg
                        });
                        await sock.sendMessage(remoteJid, {
                            audio: { url: result.audioUrl },
                            mimetype: 'audio/mp4',
                            ptt: false,
                            fileName: `${result.title}.mp3`,
                            quoted: msg
                        });
                        registerInteraction('media_request', `Áudio: ${mediaRequest.search}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'instagram') {
                    const result = await spiderXMedia.downloadInstagram(mediaRequest.url);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '📸');
                        }
                        
                        let caption = '✅ *Download do Instagram concluído!*';
                        if (result.title && result.title !== 'Post do Instagram') {
                            caption += `\n\n📝 ${result.title}`;
                        }
                        if (result.meta?.username) {
                            caption += `\n👤 @${result.meta.username}`;
                        }
                        
                        await sock.sendMessage(remoteJid, {
                            video: { url: result.videoUrl },
                            caption: caption,
                            quoted: msg
                        });
                        registerInteraction('media_request', `Instagram: ${mediaRequest.url}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'tiktok') {
                    const result = await spiderXMedia.downloadTikTok(mediaRequest.url);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '🎵');
                        }
                        await sock.sendMessage(remoteJid, {
                            video: { url: result.videoUrl },
                            caption: '✅ *Download do TikTok concluído!*',
                            quoted: msg
                        });
                        registerInteraction('media_request', `TikTok: ${mediaRequest.url}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'youtube_video') {
                    const result = await spiderXMedia.downloadYouTubeVideo(mediaRequest.url);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '🎬');
                        }
                        
                        let info = `✅ *${result.title}*`;
                        if (result.channel?.name) {
                            info += `\n\n📺 Canal: ${result.channel.name}`;
                        }
                        if (result.duration) {
                            const minutes = Math.floor(result.duration / 60);
                            const seconds = result.duration % 60;
                            info += `\n⏱️ Duração: ${minutes}:${seconds.toString().padStart(2, '0')}`;
                        }
                        info += '\n\n📥 Enviando vídeo...';
                        
                        await sock.sendMessage(remoteJid, {
                            text: info,
                            quoted: msg
                        });
                        
                        await sock.sendMessage(remoteJid, {
                            video: { url: result.videoUrl },
                            caption: `📹 ${result.title}`,
                            quoted: msg
                        });
                        registerInteraction('media_request', `YouTube: ${mediaRequest.url}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'sticker_text') {
                    const result = await spiderXMedia.generateAttpSticker(mediaRequest.text);
                    await sock.sendPresenceUpdate('available', remoteJid);
                    
                    if (result.success) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '📄');
                        }
                        await sock.sendMessage(remoteJid, {
                            sticker: result.stickerBuffer,
                            quoted: msg
                        });
                        registerInteraction('media_request', `Figurinha Texto: ${mediaRequest.text}`, userName, isGroup, groupName, 'Sucesso');
                    } else {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, {
                            text: `❌ ${result.error}`,
                            quoted: msg
                        });
                    }
                    return;
                    
                } else if (mediaRequest.type === 'sticker_image') {
                    const { exec } = require("child_process");
                    const path = require("path");
                    const fs = require("fs");
                    const { Sticker, StickerTypes } = require('wa-sticker-formatter');

                    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const imageMessage = msg.message?.imageMessage || quoted?.imageMessage;
                    
                    const pushName = msg.pushName || "Usuário";
                    const isGroupMsg = remoteJid.endsWith('@g.us');
                    let nomeLocal = "Chat Privado";

                    if (!imageMessage) {
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                        await sock.sendMessage(remoteJid, { text: '❌ Erro: Imagem não encontrada.' }, { quoted: msg });
                        return;
                    }

                    try {
                        if (isGroupMsg) {
                            nomeLocal = `Grupo: ${groupName}`;
                        }

                        console.log(`[OWNER BOT] 🖼️ Criando figurinha para: ${pushName}`);

                        const tempDir = path.resolve(__dirname, '..', 'temp');
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                        
                        const randomId = Math.floor(Math.random() * 100000);
                        const inputPath = path.join(tempDir, `in_${randomId}.jpg`);
                        const ffmpegPath = path.join(tempDir, `out_${randomId}.webp`);

                        const messageToDownload = msg.message?.imageMessage ? msg : { message: quoted };
                        const buffer = await downloadMediaMessage(
                            messageToDownload,
                            'buffer',
                            {},
                            { logger: console, reuploadRequest: sock.updateMediaMessage }
                        );

                        fs.writeFileSync(inputPath, buffer);

                        const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

                        exec(`ffmpeg -i ${inputPath} -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0" ${ffmpegPath}`, async (error) => {
                            if (error) {
                                console.error('[OWNER BOT] ❌ Erro FFMPEG:', error);
                                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                                if (isGroup) {
                                    await reactToMessage(sock, remoteJid, msg.key, '❌');
                                }
                                return;
                            }

                            try {
                                const sticker = new Sticker(fs.readFileSync(ffmpegPath), {
                                    pack: 'Criado por: AlphaBot 🤖 (11)96779-7232', 
                                    author: `\nSolicitado por: ${pushName}\n${nomeLocal}\nData: ${agora}\nDono: Ander (77)99951-2937`,
                                    type: StickerTypes.FULL,
                                    quality: 80,
                                    id: `alpha_${randomId}`
                                });

                                const stickerBuffer = await sticker.toBuffer();

                                if (isGroup) {
                                    await reactToMessage(sock, remoteJid, msg.key, '✅');
                                }
                                
                                await sock.sendMessage(remoteJid, { 
                                    sticker: stickerBuffer 
                                }, { quoted: msg });

                                registerInteraction('media_request', 'Figurinha de Imagem', userName, isGroup, groupName, 'Sucesso');

                                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                                if (fs.existsSync(ffmpegPath)) fs.unlinkSync(ffmpegPath);
                                
                            } catch (metaError) {
                                console.error('[OWNER BOT] ❌ Erro metadados:', metaError);
                                await sock.sendMessage(remoteJid, { sticker: fs.readFileSync(ffmpegPath) }, { quoted: msg });
                            }
                        });

                    } catch (err) {
                        console.error('[OWNER BOT] ❌ Erro Geral:', err.message);
                        if (isGroup) {
                            await reactToMessage(sock, remoteJid, msg.key, '❌');
                        }
                    }
                    return;
                }
                
            } catch (error) {
                console.error('[OWNER BOT] ❌ Erro mídia:', error.message);
                if (isGroup) {
                    await reactToMessage(sock, remoteJid, msg.key, '❌');
                }
                await sock.sendMessage(remoteJid, {
                    text: '❌ Erro ao processar',
                    quoted: msg
                });
                return;
            }
        }
        
        console.log('[OWNER BOT] 🤖 Enviando para IA...');
        
        const enviarDigitando = async () => {
            try {
                await sock.sendPresenceUpdate('composing', remoteJid);
            } catch (e) {}
        };
        
        const enviarResposta = async (texto, messageKey = null) => {
            try {
                await sock.sendPresenceUpdate('available', remoteJid);
                const messageOptions = { text: texto, quoted: msg };
                if (isGroup && senderJid) {
                    messageOptions.mentions = [senderJid];
                }
                await sock.sendMessage(remoteJid, messageOptions);
                registerInteraction('message', text.substring(0, 200), userName, isGroup, groupName, 'Respondido');
            } catch (e) {
                console.error('[OWNER BOT] ❌ Erro resposta:', e.message);
            }
        };
        
        await processarMensagemComDebounce(text, identifier, sock, enviarDigitando, enviarResposta, isGroup, isMentioned, msg.key);
        
        if (isGroup) {
            await reactToMessage(sock, remoteJid, msg.key, '✅');
        }
        
    } catch (error) {
        console.error('[OWNER BOT] ❌ ERRO:', error.message);
        console.error('[OWNER BOT] Stack:', error.stack);
        try {
            if (msg?.key?.remoteJid && sock) {
                if (msg.key.remoteJid.includes('@g.us')) {
                    await reactToMessage(sock, msg.key.remoteJid, msg.key, '❌');
                }
                await sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ *Erro interno do bot*',
                    quoted: msg
                });
            }
        } catch (e) {}
    }
}

module.exports = { handleOwnerIncomingMessage, isGroupAIEnabled };