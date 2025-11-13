// Imports
require('dotenv').config();
const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const session = require('express-session');
const { io } = require('socket.io-client');
const sqlite3 = require('sqlite3').verbose();
const SQLiteStore = require('connect-sqlite3')(session);


// Database setup
const db = new sqlite3.Database('./db/database.db', (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
    } else {
        console.log('Connected to SQLite database.');
    }
});

//Constants
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'your_secret_key';
const AUTH_URL = process.env.AUTH_URL || 'http://localhost:420/oauth';
const THIS_URL = process.env.THIS_URL || `http://localhost:${PORT}`;
const API_KEY = process.env.API_KEY || 'your_api_key';

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: './db' }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}))

function isAuthenticated(req, res, next) {
    if (req.session.user) next()
    else res.redirect('/login')
};

// Routes
app.get('/', isAuthenticated, (req, res) => {
    res.render('index', { user: req.session.user });
});

app.get('/user/:username/posts', isAuthenticated, (req, res) => {
    const username = req.params.username;
    db.all('SELECT * FROM posts WHERE author = ? ORDER BY timestamp DESC', [username], (err, posts) => {
        if (err) {
            console.error(err.message);
            res.render('list', {
                user: req.session.user,
                posts: [],
                pageTitle: `Posts by ${username}`
            });
        } else {
            posts.forEach(post => {
                const date = new Date(post.timestamp);
                const month = date.getMonth() + 1;
                const day = date.getDate();
                const year = date.getFullYear();
                const timeString = date.toLocaleTimeString('en-US', {
                    hour12: true,
                    hour: '2-digit',
                    minute: '2-digit'
                });
                post.timestamp = `${month}/${day}/${year} at ${timeString}`;
            });

            res.render('list', {
                user: req.session.user,
                posts: posts,
                pageTitle: `Posts by ${username}`
            });
        }
    });
});

app.get('/login', (req, res) => {
    if (req.query.token) {
        let tokenData = jwt.decode(req.query.token);
        req.session.token = tokenData;
        req.session.user = tokenData.displayName;

        // Save user to database if not exists
        db.run('INSERT OR IGNORE INTO users (username) VALUES (?)', [tokenData.displayName], function z(err) {
            if (err) {
                return console.error(err.message);
            }
            console.log(`User ${tokenData.displayName} saved to database.`);
        });

        res.redirect('/');

    } else {
        res.redirect(`${AUTH_URL}/oauth?redirectURL=${THIS_URL}`);
    };
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/createPost', isAuthenticated, (req, res) => {
    res.render('create', { user: req.session.user });
});

app.post('/createPost', isAuthenticated, (req, res) => {
    const { title, description } = req.body;
    const author = req.session.user;
    const timestamp = new Date().toISOString();

    db.run('INSERT INTO posts (title, description, author, timestamp) VALUES (?, ?, ?, ?)',
        [title, description, author, timestamp], function (err) {
            if (err) {
                return console.error(err.message);
            }
            console.log(`Post titled "${title}" created by ${author}.`);
            res.redirect('/');
        });
});

app.get('/viewPosts', isAuthenticated, (req, res) => {
    db.all('SELECT * FROM posts ORDER BY timestamp DESC', [], (err, posts) => {
        if (err) {
            console.error(err.message);
            res.render('list', { user: req.session.user, posts: [], pageTitle: 'Job Posts' });
        } else {
            posts.forEach(post => {
                const date = new Date(post.timestamp);
                const month = date.getMonth() + 1;
                const day = date.getDate();
                const year = date.getFullYear();
                const timeString = date.toLocaleTimeString('en-US', {
                    hour12: true,
                    hour: '2-digit',
                    minute: '2-digit'
                });
                post.timestamp = `${month}/${day}/${year} at ${timeString}`;
            });

            if (posts.length === 0) {
                res.render('list', { user: req.session.user, posts: [], pageTitle: 'Job Posts' });
                return;
            }

            let completedPosts = 0;
            posts.forEach(post => {
                db.all('SELECT * FROM comments WHERE post_id = ? ORDER BY timestamp ASC', [post.id], (err, comments) => {
                    if (err) {
                        console.error(err.message);
                        post.comments = [];
                    } else {
                        comments.forEach(comment => {
                            const date = new Date(comment.timestamp);
                            const month = date.getMonth() + 1;
                            const day = date.getDate();
                            const year = date.getFullYear();
                            const timeString = date.toLocaleTimeString('en-US', {
                                hour12: true,
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            comment.timestamp = `${month}/${day}/${year} at ${timeString}`;
                        });
                        post.comments = comments;
                    }

                    completedPosts++;
                    if (completedPosts === posts.length) {
                        res.render('list', { user: req.session.user, posts: posts, pageTitle: 'Job Posts' });
                    }
                });
            });
        }
    });
});

app.post('/addComment', isAuthenticated, (req, res) => {
    const { post_id, content } = req.body;
    const author = req.session.user;
    const timestamp = new Date().toISOString();

    db.run('INSERT INTO comments (post_id, author, content, timestamp) VALUES (?, ?, ?, ?)',
        [post_id, author, content, timestamp], function (err) {
            if (err) {
                return console.error(err.message);
            }
            console.log(`Comment added to post ID ${post_id} by ${author}.`);
            res.redirect('/viewPosts');
        });
});

// Socket.io Client to auth server
const socket = io(AUTH_URL, {
    extraHeaders: {
        api: API_KEY
    }
});

socket.on('connect', () => {
    console.log('Connected to auth server');
    socket.emit('getActiveClass');
});

socket.on('disconnect', () => {
    console.log('Disconnected from auth server');
});



// Start Server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
