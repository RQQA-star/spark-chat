import fs from 'fs';
import os from 'os';
import path from 'path';

// 每个测试进程分配独立的临时数据库，避免污染开发库、避免并行测试互相干扰。
// 必须在导入 server/db.js 之前设置（db.js 在模块加载时读取 SPARK_DB_PATH）。
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-test-'));
process.env.SPARK_DB_PATH = path.join(dir, 'chat.db');
