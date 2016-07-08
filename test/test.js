var sqlLoad = require("./load/sqlLoad.js");

console.log("--------Root Dir Tset---------");
root_dir_sql = sqlLoad.root_dir_test();
console.log(root_dir_sql)

console.log("--------Relative Dir Tset---------");
caller_dir_sql = sqlLoad.caller_dir_test();
console.log(root_dir_sql)