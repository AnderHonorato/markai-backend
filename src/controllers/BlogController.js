const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = {
// --- LISTAR POSTS ---
    async list(req, res) {
        const { userId } = req.query; 
        try {
            // Buscamos apenas posts que possuem ID válido e autor existente E NÃO ESTÃO DELETADOS
            const posts = await prisma.blogPost.findMany({
                where: {
                    id: { not: undefined },
                    status: { not: 'DELETED' } // FILTRO CRÍTICO ADICIONADO
                },
                orderBy: { createdAt: 'desc' },
                include: { 
                    author: { 
                        select: { 
                            name: true, 
                            avatarUrl: true, 
                            role: true 
                        } 
                    },
                    _count: { 
                        select: { 
                            likes: true, 
                            comments: true 
                        } 
                    },
                    // Verifica se o usuário logado deu like em cada post da lista
                    likes: userId ? { 
                        where: { userId }, 
                        select: { id: true } 
                    } : false
                }
            });

            // Formatação robusta para garantir que o Mobile receba dados limpos
            const formatted = posts
                .filter(p => p && p.author) // Remove posts sem autor ou nulos por erro de integridade
                .map(p => ({
                    ...p,
                    likeCount: p._count?.likes || 0,
                    commentCount: p._count?.comments || 0,
                    isLiked: userId ? (p.likes && p.likes.length > 0) : false,
                    // Removemos as relações brutas do Prisma para reduzir o tamanho do JSON enviado
                    likes: undefined, 
                    _count: undefined
                }));

            return res.json(formatted);
        } catch (error) {
            console.error("ERRO AO LISTAR BLOG:", error);
            return res.status(500).json({ 
                error: 'Erro interno ao carregar a lista de publicações.' 
            });
        }
    },

// --- DETALHES DO POST ---
    async getOne(req, res) {
        const { id } = req.params;
        const { userId } = req.query;

        // Validação básica de ID para evitar erros de cast no banco
        if (!id || id === 'undefined' || id === 'null') {
            return res.status(404).json({ error: 'ID do post inválido.' });
        }

        try {
            // 1. Primeiro verifica se o post existe e não está deletado
            const existingPost = await prisma.blogPost.findUnique({
                where: { id }
            }).catch(() => null);

            if (!existingPost || existingPost.status === 'DELETED') {
                console.log(`[Blog] 404: Post ${id} não encontrado ou foi deletado.`);
                return res.status(404).json({ error: 'Post não encontrado.' });
            }

            // 2. Atualiza o contador de visualizações e busca os dados do post
            const post = await prisma.blogPost.update({
                where: { id },
                data: { viewCount: { increment: 1 } },
                include: {
                    author: { select: { name: true, avatarUrl: true, role: true } },
                    _count: { select: { likes: true, comments: true } },
                    likes: userId ? { where: { userId }, select: { id: true } } : false
                }
            });

            // 3. Busca os comentários apenas se o post existir
            const comments = await prisma.blogComment.findMany({
                where: { 
                    postId: id, 
                    parentId: null,
                    status: { notIn: ['DELETED_BY_AUTHOR', 'DELETED_BY_MOD'] } // FILTRA COMENTÁRIOS DELETADOS
                },
                orderBy: { createdAt: 'desc' },
                include: {
                    author: { select: { name: true, avatarUrl: true, role: true } },
                    _count: { select: { likes: true, children: true } },
                    likes: userId ? { where: { userId }, select: { id: true } } : false,
                    children: { 
                        where: {
                            status: { notIn: ['DELETED_BY_AUTHOR', 'DELETED_BY_MOD'] } // FILTRA RESPOSTAS DELETADAS
                        },
                        include: {
                            author: { select: { name: true, avatarUrl: true, role: true } },
                            _count: { select: { likes: true } },
                            likes: userId ? { where: { userId }, select: { id: true } } : false
                        },
                        orderBy: { createdAt: 'asc' }
                    }
                }
            });

            // 4. Função interna para formatar os comentários (Recursiva para os filhos)
            const formatComment = (c) => ({
                ...c,
                likeCount: c._count ? c._count.likes : 0,
                replyCount: c._count ? (c._count.children || 0) : 0,
                isLiked: userId && c.likes ? c.likes.length > 0 : false,
                children: c.children ? c.children.map(child => ({
                    ...child,
                    likeCount: child._count ? child._count.likes : 0,
                    isLiked: userId && child.likes ? child.likes.length > 0 : false,
                    likes: undefined, 
                    _count: undefined
                })) : [],
                likes: undefined,
                _count: undefined
            });

            // 5. Retorno de sucesso
            return res.json({
                post: {
                    ...post,
                    likeCount: post._count?.likes || 0,
                    commentCount: post._count?.comments || 0,
                    isLiked: userId ? (post.likes?.length > 0) : false,
                    likes: undefined,
                    _count: undefined
                },
                comments: comments.map(formatComment)
            });

        } catch (error) {
            console.error("ERRO CRÍTICO GET ONE:", error);
            // P2025 é o código de erro do Prisma para "Registro não encontrado"
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Post não encontrado.' });
            }
            return res.status(500).json({ error: 'Erro interno ao carregar post.' });
        }
    },

    // --- CRIAR POST ---
    async create(req, res) {
        const { title, content, imageUrl, authorId } = req.body;
        try {
            const user = await prisma.user.findUnique({ where: { id: authorId } });
            if (!user || (user.email !== 'contato.markaiapp@gmail.com' && user.role !== 'MODERATOR' && user.role !== 'OWNER')) {
                return res.status(403).json({ error: 'Sem permissão.' });
            }
            const post = await prisma.blogPost.create({
                data: { 
                    title, 
                    content, 
                    imageUrl, 
                    authorId,
                    status: 'PUBLISHED' // DEFINE STATUS INICIAL
                }
            });
            return res.json(post);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao criar post.' });
        }
    },

    // --- ATUALIZAR POST ---
    async update(req, res) {
        const { id } = req.params;
        const { title, content, imageUrl, requesterId } = req.body;

        try {
            const user = await prisma.user.findUnique({ where: { id: requesterId } });
            if (!user || (user.email !== 'contato.markaiapp@gmail.com' && user.role !== 'MODERATOR' && user.role !== 'OWNER')) {
                return res.status(403).json({ error: 'Sem permissão.' });
            }

            const post = await prisma.blogPost.update({
                where: { id },
                data: {
                    title,
                    content,
                    imageUrl,
                    updatedAt: new Date()
                }
            });

            return res.json(post);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao atualizar post.' });
        }
    },

    // --- DELETAR POST (SOFT DELETE) ---
    async delete(req, res) {
        const { id } = req.params;
        const { requesterId } = req.query;
        try {
            const user = await prisma.user.findUnique({ where: { id: requesterId } });
            if (!user || (user.email !== 'contato.markaiapp@gmail.com' && user.role !== 'MODERATOR' && user.role !== 'OWNER')) {
                return res.status(403).json({ error: 'Sem permissão.' });
            }
            
            // SOFT DELETE: Apenas marca como DELETED ao invés de excluir
            await prisma.blogPost.update({ 
                where: { id },
                data: { status: 'DELETED' }
            });
            
            return res.json({ message: 'Post ocultado com sucesso.' });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao deletar.' });
        }
    },

    // --- ÚLTIMO POST (PARA NOTIFICAÇÃO) ---
    async getLatest(req, res) {
        try {
            const latest = await prisma.blogPost.findFirst({
                where: {
                    status: { not: 'DELETED' } // FILTRA POSTS DELETADOS
                },
                orderBy: { createdAt: 'desc' },
                // Apenas campos essenciais para a notificação na Home
                select: { id: true, title: true }
            });

            // Se não houver nenhum post, retornamos um objeto vazio com status 200.
            // Isso evita que o Axios no Frontend dispare um erro (catch).
            if (!latest) {
                return res.status(200).json(null);
            }

            return res.json(latest);
        } catch (error) {
            console.error("Erro ao buscar último post:", error);
            // Em caso de erro de banco, ainda assim retornamos 200 vazio para não quebrar a Home
            return res.status(200).json(null);
        }
    },

    // --- DELETAR COMENTÁRIO ---
    async deleteComment(req, res) {
        const { id } = req.params;
        const { requesterId } = req.query;

        try {
            const comment = await prisma.blogComment.findUnique({ where: { id } });
            if (!comment) return res.status(404).json({ error: 'Comentário não encontrado.' });

            const user = await prisma.user.findUnique({ where: { id: requesterId } });
            
            let newStatus = '';

            if (comment.authorId === requesterId) {
                newStatus = 'DELETED_BY_AUTHOR';
            } else if (user.role === 'MODERATOR' || user.role === 'OWNER' || user.email === 'contato.markaiapp@gmail.com') {
                newStatus = 'DELETED_BY_MOD';
            } else {
                return res.status(403).json({ error: 'Sem permissão.' });
            }

            await prisma.blogComment.update({
                where: { id },
                data: { 
                    status: newStatus,
                    content: '' 
                }
            });

            return res.json({ message: 'Comentário removido.' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao excluir comentário.' });
        }
    },

    // --- INTERAÇÕES SOCIAIS ---

    async toggleLikePost(req, res) {
        const { postId, userId } = req.body;
        try {
            const existing = await prisma.blogLike.findFirst({ where: { postId, userId } });
            if (existing) {
                await prisma.blogLike.delete({ where: { id: existing.id } });
                return res.json({ liked: false });
            } else {
                await prisma.blogLike.create({ data: { postId, userId } });
                return res.json({ liked: true });
            }
        } catch (e) { return res.status(500).json({ error: 'Erro no like.' }); }
    },

    async toggleLikeComment(req, res) {
        const { commentId, userId } = req.body;
        try {
            const existing = await prisma.blogLike.findFirst({ where: { commentId, userId } });
            if (existing) {
                await prisma.blogLike.delete({ where: { id: existing.id } });
                return res.json({ liked: false });
            } else {
                await prisma.blogLike.create({ data: { commentId, userId } });
                return res.json({ liked: true });
            }
        } catch (e) { return res.status(500).json({ error: 'Erro no like.' }); }
    },

    async createComment(req, res) {
        const { postId, authorId, content, parentId } = req.body;
        try {
            const comment = await prisma.blogComment.create({
                data: { postId, authorId, content, parentId }
            });
            return res.json(comment);
        } catch (e) { return res.status(500).json({ error: 'Erro ao comentar.' }); }
    }
};