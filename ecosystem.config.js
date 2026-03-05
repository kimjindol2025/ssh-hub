module.exports = {
  apps: [{
    name: 'ssh-hub',
    script: '/home/kimjin/ssh-hub/server.js',
    cwd: '/home/kimjin/ssh-hub',
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/tmp/ssh-hub-error.log',
    out_file: '/tmp/ssh-hub-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    time: true
  }]
};
