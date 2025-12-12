const express = require('express');
const session = require('express-session');
const bodyParser = require("body-parser");
const path = require('path');
const app = express();
__path = process.cwd();
const code = require('./pair'); 
const router = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'dew-md-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // set to true if using HTTPS
}));

// Routes
app.use('/freebot', code);
app.use('/api', router);

// Serve login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__path, '/frontend/login.html'));
});

// Multiple users
const ADMINS = [
  { username: 'hansadewmina', password: 'hansa2008122@' },
];

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = ADMINS.find(u => u.username === username && u.password === password);
  if(user){
    req.session.loggedIn = true;
    req.session.user = username; // store username in session
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Invalid credentials' });
  }
});

// Middleware to protect admin
function authMiddleware(req, res, next) {
    if(req.session.loggedIn){
        next();
    } else {
        res.redirect('/login');
    }
}

app.get('/api/check-session', (req, res) => {
  if(req.session && req.session.user) {
    res.json({ loggedIn: true });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get('/admin', authMiddleware, (req, res) => {
    res.sendFile(path.join(__path, '/frontend/admin.html'));
});
app.use('/pair', async (req, res, next) => {
    res.sendFile(path.join(__path, '/frontend/pair.html'));
});
app.use('/setting', async (req, res, next) => {
    res.sendFile(path.join(__path, '/frontend/settings.html'));
});
app.use('/', async (req, res, next) => {
    res.sendFile(path.join(__path, '/frontend/index.html'));
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
