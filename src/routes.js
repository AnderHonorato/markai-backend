const express = require('express');
const routes = express.Router();
const UserController = require('./controllers/UserController');
const ServiceController = require('./controllers/ServiceController');
const AppointmentController = require('./controllers/AppointmentController');
const ChatController = require('./controllers/ChatController');
const ReviewController = require('./controllers/ReviewController'); 
const CashController = require('./controllers/CashController');
const NoteController = require('./controllers/NoteController');
const AIController = require('./controllers/AIController');
const WhatsappController = require('./controllers/WhatsappController');
const BlogController = require('./controllers/BlogController');
const OwnerWhatsappController = require('./controllers/OwnerWhatsappController');

routes.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// ========== OWNER WHATSAPP (EXCLUSIVO PARA OWNER) ==========
routes.post('/owner/whatsapp/connect', OwnerWhatsappController.connect);
routes.post('/owner/whatsapp/disconnect', OwnerWhatsappController.disconnect);
routes.get('/owner/whatsapp/status', OwnerWhatsappController.getStatus);
routes.post('/owner/whatsapp/force-cleanup', OwnerWhatsappController.forceCleanup);
routes.get('/owner/whatsapp/ai-stats', OwnerWhatsappController.getAIStats);
routes.post('/owner/whatsapp/toggle-pause', OwnerWhatsappController.togglePause);
routes.post('/owner/whatsapp/toggle-groups', OwnerWhatsappController.toggleRespondGroups);

// ========== MOLTBOOK DIARY CONTROLS ==========
routes.get('/owner/moltbook/config', OwnerWhatsappController.getMoltbookConfig);
routes.post('/owner/moltbook/config', OwnerWhatsappController.updateMoltbookConfig);
routes.post('/owner/moltbook/force-post', OwnerWhatsappController.forceMoltbookPost);
routes.get('/owner/moltbook/stats', OwnerWhatsappController.getMoltbookStats);

// ========== MOLTBOOK SETUP (REGISTRO E CLAIM) ==========
routes.get('/owner/moltbook/status', OwnerWhatsappController.getMoltbookStatus);
routes.post('/owner/moltbook/register', OwnerWhatsappController.registerMoltbook);
routes.post('/owner/moltbook/validate-claim', OwnerWhatsappController.validateMoltbookClaim);

// ✅ ROTAS DE GRUPOS DO OWNER (EXISTENTES)
routes.get('/owner/whatsapp/groups', OwnerWhatsappController.getGroups);
routes.post('/owner/whatsapp/groups/:groupId/auto-message', OwnerWhatsappController.configureGroupAutoMessage);
routes.get('/owner/whatsapp/groups/:groupId/config', OwnerWhatsappController.getGroupConfig);

// ✅ NOVAS ROTAS - MÚLTIPLAS MENSAGENS E IA INDIVIDUAL
routes.post('/owner/whatsapp/groups/:groupId/auto-messages', OwnerWhatsappController.configureGroupAutoMessages);
routes.post('/owner/whatsapp/groups/:groupId/ai', OwnerWhatsappController.toggleGroupAI);
routes.get('/owner/whatsapp/groups/:groupId/ai-status', OwnerWhatsappController.getGroupAIStatus);

// ✅ NOVAS ROTAS - GERENCIAMENTO DE LID DO BOT
routes.put('/owner/whatsapp/groups/:groupId/bot-lid', OwnerWhatsappController.updateBotLID);
routes.delete('/owner/whatsapp/groups/:groupId/bot-lid', OwnerWhatsappController.resetBotLID);
routes.get('/owner/whatsapp/groups/bot-lids', OwnerWhatsappController.getAllBotLIDs);
routes.post('/owner/whatsapp/groups/:groupId/activate', OwnerWhatsappController.activateInGroup);

// ========== WHATSAPP (PRIORIDADE) ==========
routes.post('/whatsapp/connect', WhatsappController.connect);
routes.post('/whatsapp/disconnect', WhatsappController.disconnect);
routes.get('/whatsapp/status/:userId', WhatsappController.getStatus);
routes.post('/whatsapp/force-cleanup', WhatsappController.forceCleanup); // 🆕 LIMPEZA FORÇADA

// ========== USUÁRIOS ==========
routes.post('/users', UserController.create);
routes.post('/login', UserController.login);
routes.get('/professionals', UserController.listProfessionals);
routes.get('/users/nearby', UserController.listNearby); 
routes.patch('/users/:id/config', UserController.updateConfig);
routes.patch('/users/:id/block', UserController.toggleBlock);
routes.get('/users/:id', UserController.getUser); 

// ========== SEGURANÇA ==========
routes.post('/users/register-intent', UserController.registerIntent);
routes.post('/users/verify-registration', UserController.verifyRegistration);
routes.post('/users/forgot-password', UserController.forgotPassword);

// ========== SERVIÇOS ==========
routes.post('/services', ServiceController.create);
routes.get('/services/:proId', ServiceController.listByPro);
routes.delete('/services/:id', ServiceController.delete);

// ========== AGENDAMENTOS ==========
routes.post('/appointments', AppointmentController.create);
routes.get('/appointments', AppointmentController.list);
routes.patch('/appointments/:id/confirm', AppointmentController.confirm); 
routes.post('/appointments/:id/cancel', AppointmentController.cancel);
routes.post('/appointments/:id/finish', AppointmentController.finish);
routes.post('/appointments/:id/propose', AppointmentController.propose);
routes.post('/appointments/:id/respond', AppointmentController.respond);

// ========== AVALIAÇÕES ==========
routes.post('/reviews', ReviewController.create);
routes.get('/reviews/:userId', ReviewController.list);

// ========== CHAT ==========
routes.get('/messages/:userId/:otherId', ChatController.listMessages);
routes.post('/messages', ChatController.sendMessage);
routes.post('/ai/chat', AIController.chat);

// ========== FINANCEIRO ==========
routes.get('/cash/:userId', CashController.getStatus);
routes.post('/cash/open', CashController.open);
routes.post('/cash/close', CashController.close);
routes.post('/cash/reopen', CashController.reopen);

// ========== NOTAS ==========
routes.post('/notes', NoteController.saveNote);
routes.get('/notes', NoteController.getNote);

// ========== BLOG ==========
routes.get('/blog/latest', BlogController.getLatest);
routes.get('/blog', BlogController.list);
routes.get('/blog/:id', BlogController.getOne);
routes.post('/blog', BlogController.create);
routes.put('/blog/:id', BlogController.update);
routes.delete('/blog/:id', BlogController.delete);

// Rotas Sociais Blog
routes.post('/blog/like', BlogController.toggleLikePost);
routes.post('/blog/comment/like', BlogController.toggleLikeComment);
routes.post('/blog/comment', BlogController.createComment);
routes.delete('/blog/comment/:id', BlogController.deleteComment);

// ========== ADMIN ==========
routes.get('/admin/users', UserController.adminListUsers);
routes.patch('/admin/users/:id/verify', UserController.adminToggleVerify);
routes.post('/admin/users/:id/ban', UserController.adminBanUser);
routes.patch('/admin/users/:id/mod', UserController.adminToggleMod);
routes.delete('/admin/users/:id', UserController.adminDeleteUser);

// ========= KYC ==========
routes.patch('/admin/verifications/:id', UserController.adminResolveKyc);

// ========== DENÚNCIAS ==========
routes.post('/reports', UserController.createReport);
routes.get('/admin/reports', UserController.listReports);
routes.patch('/admin/reports/:id', UserController.resolveReport);
routes.delete('/admin/reports/:id', UserController.deleteReport);
routes.post('/admin/users/:id/warn', UserController.adminWarnUser);
routes.post('/users/:id/warnings/dismiss', UserController.dismissWarning);
routes.post('/users/:id/feedback/dismiss', UserController.dismissFeedback);
routes.post('/admin/global-message', UserController.adminSendGlobalMessage);
routes.post('/admin/clear-messages', UserController.adminClearGlobalMessages);
routes.get('/admin/message-stats', UserController.adminGetMessageStats);
routes.get('/admin/verifications', UserController.adminListVerifications);
routes.get('/admin/message-stats', UserController.adminGetStats);

// ========== SLUG (SEMPRE POR ÚLTIMO) ==========
routes.get('/:slug', UserController.getBySlug);


console.log('✅ Rotas carregadas com sucesso');

module.exports = routes;