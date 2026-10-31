"""
app.py — PriditorTypeshit server (Flask + SQLite)

On your computer:  python app.py      → open http://127.0.0.1:5000
On a host:         gunicorn app:app
"""
import json
import os
import re
import secrets
import sqlite3
import time
import urllib.parse
import urllib.request

from flask import Flask, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
app.config.update(
    # On your host, set SECRET_KEY. Otherwise everyone is logged out on restart.
    SECRET_KEY=os.environ.get('SECRET_KEY') or secrets.token_hex(32),
    DB_PATH=os.environ.get('DB_PATH', os.path.join(BASE_DIR, 'pts.db')),
    # Google's public TEST keys. They always pass, so replace them with your own keys when you publish.
    RECAPTCHA_SITE_KEY=os.environ.get('RECAPTCHA_SITE_KEY', '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'),
    RECAPTCHA_SECRET_KEY=os.environ.get('RECAPTCHA_SECRET_KEY', '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe'),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('PTS_HTTPS') == '1',  # set PTS_HTTPS=1 when the site uses https
)

USERNAME_RE = re.compile(r'^[A-Za-z0-9_.]{3,20}$')

# Usernames that get admin mode. Matching ignores upper and lower case.
ADMIN_USERNAMES = {'zetaloimak', 'rakfocus'}

# Plans for sale. The server is the source of truth for prices.
# Keep these in sync with the prices shown on product.html.
PLANS = {
    1: {'amount': 1,   'unit': 'GB', 'price': 99},
    2: {'amount': 100, 'unit': 'GB', 'price': 159},
    3: {'amount': 500, 'unit': 'GB', 'price': 199},
    4: {'amount': 1,   'unit': 'TB', 'price': 259},
    5: {'amount': 5,   'unit': 'TB', 'price': 299},
    6: {'amount': 6,   'unit': 'TB', 'price': 399},
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS access_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code       TEXT    NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,            -- Unix time in seconds
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""


# ---------- database ----------
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(app.config['DB_PATH'])
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(app.config['DB_PATH'])
    conn.executescript(SCHEMA)
    conn.close()


init_db()


# ---------- helpers ----------
def is_admin():
    """True when the logged-in account is an admin. Checked on the server every request."""
    user = session.get('user')
    return bool(user) and user.lower() in ADMIN_USERNAMES


@app.context_processor
def inject_user():
    """Makes {{ user }}, {{ is_admin }} and {{ site_key }} available in every template."""
    return {
        'user': session.get('user'),
        'is_admin': is_admin(),
        'site_key': app.config['RECAPTCHA_SITE_KEY'],
    }


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def fail(message, status=400):
    return jsonify(ok=False, message=message), status


def verify_recaptcha(token):
    """Asks Google if the captcha token is real. This runs on the server, so it cannot be faked in the browser."""
    if not token:
        return False
    body = urllib.parse.urlencode({
        'secret': app.config['RECAPTCHA_SECRET_KEY'],
        'response': token,
    }).encode()
    try:
        with urllib.request.urlopen(
            'https://www.google.com/recaptcha/api/siteverify', data=body, timeout=10
        ) as res:
            return bool(json.load(res).get('success'))
    except Exception:
        return False


# ---------- pages ----------
@app.get('/')
def index():
    return render_template('index.html')


@app.get('/download')
def download():
    if not session.get('user'):
        return redirect(url_for('index', login=1))
    return render_template('download.html')


@app.get('/product')
def product():
    return render_template('product.html')


@app.get('/sell')
def sell():
    if not session.get('user'):
        return redirect(url_for('index', login=1, next=request.full_path.rstrip('?')))
    selected = request.args.get('plan', type=int)
    return render_template('sell.html', plans=PLANS, selected=selected)


@app.get('/pay/<int:plan_id>')
def pay(plan_id):
    if not session.get('user'):
        return redirect(url_for('index', login=1, next=request.path))
    plan = PLANS.get(plan_id)
    if plan is None:
        return redirect(url_for('sell'))
    return render_template('pay.html', plan_id=plan_id, plan=plan)


@app.get('/admin')
def admin():
    if not is_admin():
        return redirect(url_for('index'))
    rows = get_db().execute(
        'SELECT id, username, created_at FROM users ORDER BY id'
    ).fetchall()
    admin_count = sum(1 for r in rows if r['username'].lower() in ADMIN_USERNAMES)
    return render_template(
        'admin.html',
        users=rows,
        admin_names=ADMIN_USERNAMES,
        admin_count=admin_count,
        newest=rows[-1]['username'] if rows else '—',
    )


# ---------- API ----------
@app.post('/api/signup')
def api_signup():
    data = json_body()
    username = str(data.get('username', '')).strip()
    password = str(data.get('password', ''))
    captcha = str(data.get('captcha', ''))

    if not USERNAME_RE.match(username):
        return fail('Username: 3–20 letters, numbers, _ or .')
    if username.lower() in ADMIN_USERNAMES:
        return fail('That username is reserved.')
    if not 6 <= len(password) <= 128:
        return fail('Password must be 6 to 128 characters.')
    if not verify_recaptcha(captcha):
        return fail('Security check failed. Please try again.')

    db = get_db()
    try:
        db.execute(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            (username, generate_password_hash(password)),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return fail('That username is already taken.', 409)

    return jsonify(ok=True, message='Account created! Now log in.')


@app.post('/api/login')
def api_login():
    data = json_body()
    username = str(data.get('username', '')).strip()
    password = str(data.get('password', ''))

    if not username or not password:
        return fail('Please enter your username and password.')

    row = get_db().execute(
        'SELECT id, username, password_hash FROM users WHERE username = ?', (username,)
    ).fetchone()
    if row is None or not check_password_hash(row['password_hash'], password):
        return fail('Wrong username or password.', 401)

    session.clear()
    session['user_id'] = row['id']
    session['user'] = row['username']
    return jsonify(ok=True, user=row['username'])


@app.post('/api/logout')
def api_logout():
    session.clear()
    return jsonify(ok=True)


@app.post('/api/check-code')
def api_check_code():
    """For your program: POST {"code": "PTS-XXXX-XXXX"} → {"valid": true, "user": "name"}"""
    code = str(json_body().get('code', '')).strip().upper()
    row = get_db().execute(
        '''SELECT u.username, c.expires_at
           FROM access_codes c
           JOIN users u ON u.id = c.user_id
           WHERE c.code = ?''',
        (code,),
    ).fetchone()

    if row is None or row['expires_at'] < time.time():
        return jsonify(valid=False, message='Invalid or expired code.')
    return jsonify(valid=True, user=row['username'])


if __name__ == '__main__':
    app.run(debug=True)  # debug mode is for your computer only. Turn it off on a host.