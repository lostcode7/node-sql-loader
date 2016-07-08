# Node SQL Loader

## Descrition

This is simple sql file loader for node js. if you want to manage your `query` by `.sql` file than you can use this.

## Install

	npm install sql-loader

## Example

```javascript
var sqlLoader = require("sql-loader");

var sql = sqlLoader("../sql/directory/path"); // You can use Relative path || Absolute Path

// sql.filename 
// if you contain 'test.sql' in directory, you can load sql by sql.test
db.query(sql.test, (err, rows) => {
	if(err) {
		throw err;
	} else {
		console.dir(rows);
	}
})
```

## Recursive directory search

You can divide your sql file by direcotry. if you that, the module do recursive search and load sql file.

	SQL_DIRECTORY
	ㄴ get
		ㄴ user.sql
	ㄴ insert
		ㄴ date.sql
	ㄴ update
		ㄴ info.sql

Sql Loader Load this file like this

```json
{
	"get" : {
		"user" : "Your sql"
	},
	"insert" : {
		"date" : "Your sql"
	},
	"update" : {
		"info" : "Your sql"
	}
}
```