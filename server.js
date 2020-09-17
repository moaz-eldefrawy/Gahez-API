/*
	Required Modules
*/
const express = require("express");
const app = express();
const path = require("path");
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  perMessageDeflate: false
});
const socketRouting = require("./routes/socket")

const {
  v4: uuidv4
} = require('uuid');
console.log(uuidv4());
const bodyParser = require("body-parser");
const passwordHash = require("password-hash");
const fileUpload = require('express-fileupload');
const {
  Pool,
  Client,
  pool
} = require("./db/index.js");

/* middlewares*/
app.disable('x-powered-by');
app.use("/photos", express.static('photos'))
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(fileUpload({
  createParentPath: true,
}));
app.use(bodyParser.json());


/*
	constants
*/
const dev = (process.env.DEV === "true");
const port = process.env.PORT || "8000";
const radiusDistance = 10;

/*
	Routes
*/

app.get("/test", async (req, res) => {
  res.sendFile(__dirname + "/test.html")
});

app.get("/", async (req, res) => {
  res.sendFile(__dirname + '/index.html');
});


/* helping functions */

function throwErrorIfUndefined(variable){
//  console.log(variable)
  if(variable == undefined) throws("undefined variable")
  if(Array.isArray(variable) === true){
    for(let i=0; i<variable.length; i++){
      if(variable[i] == undefined) throws ("undefined variable");
    }
  }
}

function isUndefined(variable){
//  console.log(variable)
  if(variable == undefined) return true
  if(Array.isArray(variable) === true){
    for(let i=0; i<variable.length; i++){
      if(variable[i] == undefined) return true
    }
  }
  return false
}

function getCurrentDate() {

  function appendLeadingZeroes(n) {
    if (n <= 9) {
      return "0" + n;
    }
    return n
  }

  let current_datetime = new Date()
  let formatted_date = current_datetime.getFullYear() + "-" + appendLeadingZeroes(current_datetime.getMonth() + 1) + "-" +
    appendLeadingZeroes(current_datetime.getDate()) + " " + appendLeadingZeroes(current_datetime.getHours()) + ":" +
    appendLeadingZeroes(current_datetime.getMinutes()) + ":" + appendLeadingZeroes(current_datetime.getSeconds());
  return formatted_date;
}

async function getImages(images, names, path) {
  for (let i = 0; i < images.size(); i++) {
    images[i].mv(path + "/" + names[i]);
  }
}


/* --------- CHAT and orderConfirmation ------------*/
//io.use()

// orders that are confirmed by the client but not the carrier (yet)
io.clientConfirmedOrders = {}
io.on("connection", async function (socket) {
  console.log("new connection");



  socket.userId = socket.handshake.query && socket.handshake.query.id;
  socket.userType = socket.handshake.query && socket.handshake.query.userType;
  if(isUndefined[socket.userId,socket.userType]){
    socket.emit("erorr", "id or userType isn't defined")
    socket.disconnect(true)
    return
  }

  socketRouting.clientOrCarrier(socket,io);

  if(socket.userType === "client"){
    socketRouting.client(socket,io)
  } else if (socket.userType === "carrier"){
    socketRouting.carrier(socket,io);
  } else {
    socket.emit("erorr", "userType isn't defined correctly")
    socket.disconnect(true)
    return false;
  }
  // TODO: verify user first. (io.use())


  socket.on("disconnect", () => {
    console.log("user disconnected!");
  })

})

/* --------- message ----------- */
app.get("/orders/:orderId/messages", async (req, res) => {
  console.log(req.params.orderId);
  try {
    const {
      rows
    } = await pool.query("SELECT line_text, created_at FROM chats WHERE order_id=$1", [req.params.orderId]);
    res.json(rows)
  } catch (err) {
    res.status(404).send(err);
  }
})

app.get("/clients/:Id", async (req, res) => {
  try {
    let client = await pool.query("SELECT name, email, phone, photo, gender FROM clients WHERE client_id=$1", [req.params.Id]);
    res.json(client.rows[0]);
  } catch (err) {
    res.status(404).send(err);
  }
});

app.get("/clients/:clientId/orders", async (req, res) => {
  let clientId = req.params.clientId;
  try {

    const clientOrders = await pool.query(
      `select ord.*,
		(select json_agg(t) from
			(
				 select it.*,
					(select json_agg(p) from(
							 SELECT photo as photoPath from item_photos as ip
							 WHERE ip.item_id = it.item_id
					 ) as p) as itemPhotos

					from items as it
					where it.order_id = ord.order_id
			) as t
		) as items

		from orders as ord WHERE client_id=$1`, [clientId]);

    res.json(clientOrders.rows);
  } catch (err) {
    console.error(err);
    res.status(404).end();
  }
})

app.get("/carriers/:Id", async (req, res) => {
  try {
    let {
      rows
    } = await pool.query("SELECT name, email, phone, photo, gender, vehicle FROM carriers WHERE carrier_id=$1", [req.params.Id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(404).send(err);
  }
});

app.get("/carriers/:carrierId/orders", async (req, res) => {
  let carrierId = req.params.carrierId;

  try {
    const carrierOrders = pool.query(
      `select ord.*,
		(select json_agg(t) from
		  (
		     select it.*,
		      (select json_agg(p) from(
		           SELECT photo as photoPath from item_photos as ip
		           WHERE ip.item_id = it.item_id
		       ) as p) as itemPhotos

		      from items as it
		      where it.order_id = ord.order_id
		  ) as t
		) as items
		from orders as ord WHERE carrier_id=$1`, [carrierId])

    res.json(carrierOrders.rows);
  } catch (err) {
    console.error(err);
    res.status(404).end();
  }
})

let userLocations = {};
/* {
	8: {
	"x": "3",
	"y": "4"
	},
	50: {
	"x": "100",
	"y": "100"
	},
	80: {
	"x": "10",
	"y": "10"
	},
	6:{
		"x":"20",
		"y":"21"
	}

}*/

app.get("/getCarriers/:vehicleType", async (req, res) => {
  let vehicleType = req.params.vehicleType;
  let x = req.query.x;
  let y = req.query.y;

  // don't block the main thread !!

  let userIds = Object.keys(userLocations);
  let availableCarriers = []; //= [1,2,3,4];
  for (var i = 0; i < userIds.length; i++) {
    let distance = ((x - userLocations[userIds[i]].x) * (x - userLocations[userIds[i]].x) + (y - userLocations[userIds[i]].y) * (y - userLocations[userIds[i]].y));
    console.log(distance);
    if (distance <= radiusDistance * radiusDistance) {
      availableCarriers.push(userIds[i])
    }

  }
  //res.send(availableCarriers); // not tested yet
  let queryText = "";
  for (var i = 0; i < availableCarriers.length; i++) {
    queryText += "carri	er_id=$" + (i + 1);
    if (i < availableCarriers.length - 1)
      queryText += " OR ";
  }

  try {
    console.log(queryText);
    // add vehicle to WHERE condition
    let info = await pool.query("SELECT carrier_id, name, email, password, phone, address, gender, vehicle FROM carriers WHERE " + queryText, availableCarriers);
    res.send(info);
  } catch (err) {
    console.log(err);
    res.end("error occurred!");
  }
});
app.post("/updateLocation", async (req, res) => {

});

/* --------- orders ----------- */
// not used for now

app.post("/orders/updateOrder/:orderId", async (req, res) => {

	let clientId = req.body.clientId;
  let carrierId = req.body.carrierId;
	let order = req.body;
	let orderId = req.params.orderId;
  let items = order.items || [];
	if(Array.isArray(items) === false) // means one item
			items = [items]
  console.log("order", req.body);
  console.log("items->", items)
  var client;
  try {
    client = await pool.connect();
    await client.query("BEGIN")
		await client.query("DELETE FROM orders WHERE order_id=$1", [orderId]);
    const result = await client.query("INSERT INTO orders(order_id,fee,status,delivery_date,"+
		"receiver_name,receiver_phone,client_id,carrier_id)"+
		" VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [orderId, order.fee, "pending", order.deliveryDate, order.receiverName, order.receiverPhone, clientId, carrierId]);

		let processes = [];
    for (var i = 0; i < items.length; i++) {
      items[i] = JSON.parse(items[i]);
			console.log("item ->", items[i]);
			let itemId = await uuidv4();
      let processZero = client.query("INSERT INTO items(item_id,name,description,weight,price,order_id)"+
			" VALUES($1,$2,$3,$4,$5,$6)",
        [itemId, items[i].name, items[i].description, items[i].weight, items[i].price, orderId]);
			processes.push(processZero)

			for(var j=0; (items[i].images && j<items[i].images.length); j++){
				let imgName = items[i].images[j]
				let img = req.files[imgName]
				console.log("img->", img);
				let imgPath = "/photos/orders/"+orderId+"/"+itemId+"/"+img.name;
				let processOne = client.query("INSERT INTO item_photos(item_id,photo) VALUES($1,$2)",
				[itemId,imgPath]);
				let processTwo = img.mv("."+imgPath);
				processes.push(processOne)
				processes.push(processTwo)

			}
    }

    await Promise.all(processes).then(async () => {
      await client.query("COMMIT");
      client.release();
      res.end("orderId:", orderId);
    })

  } catch (err) {
    console.error(err);
    // the client may not connect thus calling client.release throws an error
    if (client) {
      await client.query("ROLLBACK");
      await client.release();
    }
    res.status(500).send(err);
  }

})

app.post("/orders/newOrder", async (req, res) => {
  let clientId = req.body.clientId;
  let carrierId = req.body.carrierId;
  let order = req.body;
	console.log("order", req.body);
  var client;
  try {
    let items = JSON.parse(order.items)
    console.log("items->", items)
    client = await pool.connect();
    await client.query("BEGIN")
    let orderId = await uuidv4();
    const result = await client.query("INSERT INTO orders(order_id,fee,status,delivery_date,"+
		"receiver_name,receiver_phone,client_id,carrier_id)"+
		" VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [orderId, order.fee, "pending", order.deliveryDate, order.receiverName, order.receiverPhone, clientId, carrierId]);

		let processes = [];
    for (var i = 0; i < items.length; i++) {
      console.log("item ->", items[i]);
			let itemId = await uuidv4();
      let processZero = client.query("INSERT INTO items(item_id,name,description,weight,price,order_id)"+
			" VALUES($1,$2,$3,$4,$5,$6)",
        [itemId, items[i].name, items[i].description, items[i].weight, items[i].price, orderId]);
			processes.push(processZero)

			for(var j=0; (items[i].images && j<items[i].images.length); j++){
				let imgName = items[i].images[j]
				let img = req.files[imgName]
				console.log("img->", imgName);
				let imgPath = "/photos/orders/"+orderId+"/"+itemId+"/"+img.name;
				let processOne = client.query("INSERT INTO item_photos(item_id,photo) VALUES($1,$2)",
				[itemId,imgPath]);
				let processTwo = img.mv("."+imgPath);
				processes.push(processOne)
				processes.push(processTwo)

			}
    }

    await Promise.all(processes).then(async () => {
      await client.query("COMMIT");
      client.release();
      res.status(200).end("orderId:"+ orderId);
    })

  } catch (err) {
    console.error(err);
    // the client may not connect thus calling client.release throws an error
    if (client) {
      await client.query("ROLLBACK");
      await client.release();
    }
    res.status(500).send(err);
  }

});

app.get("/orders/:orderId", async (req, res) => {
  let orderId = req.params.orderId;
  try {
		const clientOrders = await pool.query(
			`select ord.*,
		(select json_agg(t) from
			(
				 select it.*,
					(select json_agg(p) from(
							 SELECT photo as photoPath from item_photos as ip
							 WHERE ip.item_id = it.item_id
					 ) as p) as itemPhotos

					from items as it
					where it.order_id = ord.order_id
			) as t
		) as items

		from orders as ord WHERE order_id=$1`, [orderId]);
    res.json(clientOrders.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).end(err);
  }
});
// confirm order given orderID
app.post("/orders/:orderId/confirm", async (req, res) => {
  let orderId = req.params.orderId;
  let carrierId = req.body.carrierId;
  try {
    let order = await pool.query("SELECT status FROM orders WHERE order_id=$1", [orderId]);
    if (order.rows[0].status === 'pending' && carrierId) {
      await pool.query("UPDATE orders SET status='confirmed', carrier_id=$1 WHERE order_id=$2", [carrierId,orderId]);
    } else {
      res.status("405").end("order isn't pending to be confirmed or carrierId not given");
    }
    res.status(200).end("request successful");
  } catch (err) {
		console.error(err)
    res.status(400).send(err);
  }
});

app.post("/orders/:orderId/delivered", async (req, res) => {
  let orderId = req.params.orderId;
  try {
    let order = await pool.query("SELECT status FROM orders WHERE order_id=$1", [orderId]);
    console.log(order.rows);
    if (order.rows[0].status === 'confirmed') {
      await pool.query("UPDATE orders SET status='delivered' WHERE order_id=$1", [orderId]);
    } else {
      res.status("405").end("order isn't confirmed to be delivered");
    }
    res.status(200).end("request successful");
  } catch (err) {
    res.status(400).end();
  }
});

// path inclusuve of last '/'
// fileName (with exentsion)
function constructPath(fileName, newFileName, path) {
  return path + newFileName + "." + fileName.split(".")[1]
}

app.post("/signUp", async (req, res) => {
  //console.log("req.body", req.body);
  let user = req.body;
  // name address email pswd gender phone number
  // userType = client or carrier
  var client;

  if (user.userType === "client") {
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      let userPhoto = req.files && req.files.userPhoto;
      let newPhotoPath;
      let clientId = await uuidv4();
      if (userPhoto)
        newPhotoPath = constructPath(userPhoto.name, "personalPhoto", "/photos/clients/" + clientId + "/")
      console.log("--> inserting into clients")
      const result = await client.query("INSERT INTO clients" +
        "(client_id,name,email,password,address,phone,gender,photo) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [clientId, user.name, user.email, user.password, user.address, user.phone, user.gender, newPhotoPath]);

      if (userPhoto)
        await userPhoto.mv("." + newPhotoPath);
      await client.query("COMMIT");
      res.json(result.rows[0]); // TODO: send orderId only
    } catch (err) {
      console.log("catching failture -> ", err);
      if (client) await client.query("ROLLBACK");
      res.status(500).send({error:err});
    } finally {
      if (client) client.release();
    }
  } else if (user.userType == "carrier") {
    //user.vehicle =
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      let userId = await uuidv4();
      let userPhoto = req.files.userPhoto;
      let licensePhotoFront = req.files.licensePhotoFront;
      let licensePhotoBack = req.files.licensePhotoBack;
      let idCardFront = req.files.idCardFront;
      let idCardBack = req.files.idCardBack;

      let userPhotoPath = "/photos/carriers/" + userId + "/userPhoto." + userPhoto.name.split(".")[1];
      let licensePhotoFrontPath = "/photos/carriers/" + userId + "/licensePhotoFront." + licensePhotoBack.name.split(".")[1];
      let licensePhotoBackPath = "/photos/carriers/" + userId + "/licensePhotoBack." + licensePhotoFront.name.split(".")[1];
      let idCardFrontPath = "/photos/carriers/" + userId + "/idCardFront." + idCardFront.name.split(".")[1];
      let idCardBackPath = "/photos/carriers/" + userId + "/idCardBack." + idCardBack.name.split(".")[1];

      console.log("--> inserting into carriers");
      const result = await client.query("INSERT INTO carriers" +
        "(carrier_id,name,email,password,address,phone,gender,vehicle,national_id,active" +
        ",photo,license_photo_front,license_photo_back,id_photo_front,id_photo_back)" +
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
        [userId, user.name, user.email, user.password, user.address, user.phone, user.gender, user.vehicle, user.nationalId, false,
          userPhotoPath, licensePhotoFrontPath, licensePhotoBackPath, idCardFrontPath, idCardBackPath
        ]);

      let p1 = userPhoto.mv("." + userPhotoPath);
      let p2 = licensePhotoFront.mv("." + licensePhotoFrontPath);
      let p3 = licensePhotoBack.mv("." + licensePhotoBackPath);
      let p4 = idCardFront.mv("." + idCardFrontPath);
      let p5 = idCardBack.mv("." + idCardBackPath);

      await Promise.all([p1, p2, p3, p4, p5]).then(async () => {
        client.query("COMMIT");
        res.json(result.rows[0]);
      })
    } catch (err) {
      console.log("catch outside try -> ", err)
      if (client) await client.query("ROLLBACK");
      res.status(400).send({error:err});
    } finally {
      if (client) client.release();
    }
  } else {
    res.end("Invalid user type.")
  }

})

app.post("/signIn", async (req, res) => {
  let user = req.body;
  console.log(user);
  if (user.userType === "client" || user.userType === "carrier") {
    try {
      console.log("fetching");
      const results = await pool.query("SELECT * FROM " + user.userType + "s WHERE email=$1", [user.email]);
      const result = results.rows[0];
      console.log(results.rows);

      if (!result)
        res.end("email doesn't exist");

      if (result.password === user.password)
        res.json(result);
      else
        res.end("incorrect password");
    } catch (e) {
      res.end(e);
    }
  } else {
    res.end("invalid user type, try again correctly");
  }
});

app.all("*", (req, res) => {
  res.send("not a valid request");
})
/*
	activation
*/

http.listen(port, () => {
  console.log("Listening on port", port);
});




/*
1- UPDATE DATABASE file with facebook (ur messages with abdelrahman)
2- authorization
3- create routers for users and orders
4-

*/
