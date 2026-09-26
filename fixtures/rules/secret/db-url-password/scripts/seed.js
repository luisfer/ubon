const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://admin:{{fake:db-password:3}}@cluster0.q1w2e3.mongodb.net/prod?retryWrites=true'; // expect: secret/db-url-password
const client = new MongoClient(uri);

const mysqlUrl = 'mysql://root:{{fake:db-password:4}}@10.0.4.12:3306/shop'; // expect: secret/db-url-password
const template = 'mysql://<user>:<password>@<host>/<db>'; // ok: placeholder in angle brackets
