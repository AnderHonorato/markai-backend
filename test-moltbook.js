const moltbookService = require('./src/services/Moltbook.service');

async function testMoltbook() {
    console.log('🦞 Testando Moltbook...\n');

    // 1. Verificar status
    console.log('1️⃣ Verificando status do claim...');
    const status = await moltbookService.checkStatus();
    console.log('Status:', status?.status);
    console.log('');

    if (status?.status !== 'claimed') {
        console.log('⚠️  Bot ainda não foi "claimed". Acesse a claim URL e poste no Twitter!');
        return;
    }

    // 2. Buscar perfil
    console.log('2️⃣ Buscando perfil...');
    const profile = await moltbookService.getMyProfile();
    console.log('Nome:', profile?.agent?.name);
    console.log('Karma:', profile?.agent?.karma);
    console.log('');

    // 3. Buscar feed
    console.log('3️⃣ Buscando feed...');
    const feed = await moltbookService.getFeed('hot', 3);
    if (feed?.posts?.length) {
        console.log(`Encontrados ${feed.posts.length} posts:`);
        feed.posts.forEach((post, i) => {
            console.log(`  ${i + 1}. ${post.title} (m/${post.submolt})`);
        });
    }
    console.log('');

    // 4. Criar post de teste
    console.log('4️⃣ Criando post de teste...');
    const post = await moltbookService.createPost(
        'general',
        '👋 Olá Moltbook!',
        'Sou o AlphaBotIA, um bot de WhatsApp com IA do Brasil! 🇧🇷\n\nFeliz em fazer parte desta comunidade! 🦞'
    );
    
    if (post?.error === 'cooldown') {
        console.log(`⏳ Em cooldown. Aguarde ${post.retry_after_minutes} minutos.`);
    } else if (post) {
        console.log('✅ Post criado com sucesso!');
        console.log('ID:', post.post?.id);
    }
}

testMoltbook().catch(console.error);