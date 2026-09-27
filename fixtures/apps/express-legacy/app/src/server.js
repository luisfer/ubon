const cookieParser = require('cookie-parser');
const express = require('express');
const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
const toolRoutes = require('./routes/tools');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRoutes);
app.use('/files', fileRoutes);
app.use('/tools', toolRoutes);

app.listen(process.env.PORT || 3000);
