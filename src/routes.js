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
// --- ADICIONE ESTA LINHA ABAIXO ---
const WhatsappController = require('./controllers/WhatsappController');
routes.post('/whatsapp/disconnect', WhatsappController.disconnect); // Nova
routes.get('/whatsapp/status/:userId', WhatsappController.getStatus); // Nova

routes.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// USUÁRIOS
routes.post('/users', UserController.create);
routes.post('/login', UserController.login);
routes.get('/professionals', UserController.listProfessionals);
routes.get('/users/nearby', UserController.listNearby); 
routes.patch('/users/:id/config', UserController.updateConfig);
routes.patch('/users/:id/block', UserController.toggleBlock);
routes.get('/users/:id', UserController.getUser); 

// SEGURANÇA
routes.post('/users/register-intent', UserController.registerIntent);
routes.post('/users/verify-registration', UserController.verifyRegistration);
routes.post('/users/forgot-password', UserController.forgotPassword);

// SERVIÇOS
routes.post('/services', ServiceController.create);
routes.get('/services/:proId', ServiceController.listByPro);
routes.delete('/services/:id', ServiceController.delete);

// AGENDAMENTOS
routes.post('/appointments', AppointmentController.create);
routes.get('/appointments', AppointmentController.list);
routes.patch('/appointments/:id/confirm', AppointmentController.confirm); 
routes.post('/appointments/:id/cancel', AppointmentController.cancel);
routes.post('/appointments/:id/finish', AppointmentController.finish);
routes.post('/appointments/:id/propose', AppointmentController.propose);
routes.post('/appointments/:id/respond', AppointmentController.respond);

// AVALIAÇÕES
routes.post('/reviews', ReviewController.create);
routes.get('/reviews/:userId', ReviewController.list);

// CHAT
routes.get('/messages/:userId/:otherId', ChatController.listMessages);
routes.post('/messages', ChatController.sendMessage);
routes.post('/ai/chat', AIController.chat);
routes.post('/whatsapp/connect', WhatsappController.connect);

// FINANCEIRO
routes.get('/cash/:userId', CashController.getStatus);
routes.post('/cash/open', CashController.open);
routes.post('/cash/close', CashController.close);
routes.post('/cash/reopen', CashController.reopen);

// NOTAS
routes.post('/notes', NoteController.saveNote);
routes.get('/notes', NoteController.getNote);

// SLUG
routes.get('/:slug', UserController.getBySlug); 

// --- ROTAS ADMINISTRATIVAS ---
routes.get('/admin/users', UserController.adminListUsers);
routes.patch('/admin/users/:id/verify', UserController.adminToggleVerify);
routes.post('/admin/users/:id/ban', UserController.adminBanUser);
routes.patch('/admin/users/:id/mod', UserController.adminToggleMod);
routes.delete('/admin/users/:id', UserController.adminDeleteUser);

// --- ROTAS DE DENÚNCIA ---
routes.post('/reports', UserController.createReport);
routes.get('/admin/reports', UserController.listReports);
routes.patch('/admin/reports/:id', UserController.resolveReport);
routes.delete('/admin/reports/:id', UserController.deleteReport);
routes.post('/admin/users/:id/warn', UserController.adminWarnUser);
routes.post('/users/:id/warnings/dismiss', UserController.dismissWarning);
routes.post('/users/:id/feedback/dismiss', UserController.dismissFeedback);
router.post('/admin/global-message', UserController.adminSendGlobalMessage);
router.post('/admin/clear-messages', UserController.adminClearGlobalMessages);
router.get('/admin/message-stats', UserController.adminGetMessageStats);

console.log('✅ Rotas carregadas com sucesso');

module.exports = routes;
