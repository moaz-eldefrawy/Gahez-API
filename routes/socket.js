const {
  Pool,
  Client,
  pool
} = require("../db/index");
const color = require("colors")


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


let handleClient = async function(socket,io){
  socket.carriers = {};
  socket.on("currentOrder", async function(orderId){
    try {
      throwErrorIfUndefined(orderId);
      socket.order = new Promise(async function(resolve){
        let r = await pool.query("SELECT * FROM orders WHERE order_id=$1",[orderId]);
        resolve(r.rows[0])
      })

      socket.order = await socket.order
      console.log("sokcet.order->".cyan,socket.order)
      socket.orderId = orderId; // to prevent handling multiple orders
      socket.carriers = [];

    } catch(err) {
      console.error(err);
      io.in(socket.userId).emit("mistake", err.toString());
      return false;
    }

  })

  socket.on("notifyCarrier", async function(carrierId){
    try {
      throwErrorIfUndefined([carrierId]);
      console.log(socket.carriers)
      if(socket.carriers[carrierId] != undefined)
        throw("carrier has already received the order")
      socket.order = (await socket.order)
      console.log(`-- notifiying carrier -- ${carrierId}`.cyan)
      io.to(carrierId).emit("newOrder",socket.order);
      socket.carriers[carrierId] = "notified"
    } catch(err){
      console.error(err);
      socket.emit("mistake",err.toString())
    }

  })

  socket.on("acceptCarrier", async function(obj){
    if(isUndefined([obj,obj.carrierId,obj.waitTime])){
      return false;
    }
    // make sure carrier is notified and that order isn't pending
    waitTime = obj.waitTime
    acceptingCarrier = obj.carrierId;
    acceptedOrder = socket.orderId;
    console.log(socket.carriers)
    if(socket.carriers[obj.carrierId] != "notified"){
      socket.emit("mistake", "carrier doesn't know about the order to accept it")
      return false
    }
    // accpet only one carrier at a time
    if(io.clientConfirmedOrders[acceptedOrder] != undefined){
      socket.emit("mistake", "a carrier was asked to accept the order (and only one is allowed to at a time)")
      return false
    }

    console.log(`client (${socket.id}) requests carrier (${obj.carrierId}) for order (${socket.orderId})`.cyan)
    io.in(acceptingCarrier).emit("acceptOrder", {
      orderId: acceptedOrder,
      orderNumber: socket.order_number
    });

    io.clientConfirmedOrders[acceptedOrder] = acceptingCarrier
    setTimeout(()=>{
      io.clientConfirmedOrders[acceptedOrder] = undefined;
    }, waitTime)
  });
}

let handleCarrier = async function(socket,io){
  socket.emit("hello")
  socket.on("acceptOrder", async function(obj){
    try{
      throwErrorIfUndefined([obj,obj.clientId,obj.orderId])
      // make sure client has already sent a request to the carrier to accept the order
      if(io.clientConfirmedOrders[obj.orderId] != socket.userId){
        throw Error("You can't accept that order (too late to accept or the order isn't assigned to you)")
      }
      let z = await pool.query("UPDATE orders SET carrier_id=$1, status=$2 WHERE"+
      " order_id=$3 And status=$4",[socket.userId,"confirmed",obj.orderId,"pending"])
      if(z.rowCount === 0){ // nothing changed
        console.log(z.rowCount, " already taken ")
        throw Error("This order already has a carrier")
      }
      io.clientConfirmedOrders[obj.orderId] = undefined; // no one can further accept the order
      console.log(`Order (${obj.orderId}) is confirmed`.cyan)
      io.in(obj.clientId).in(socket.userId).emit("orderConfirmed", "done");
    } catch(err){
      console.error(err);
      socket.emit("mistake", err.toString());
    }
  })


}

let handleBoth = async function(socket,io){
  console.log("sokcet.id--->",socket.userId)
  socket.join(socket.userId)
  socket.on("join chat", async function (info){
      let clientId = info.clientId;
      let carrierId = info.carrierId;
      socket.orderIdId = info.orderId;
      roomId = clientId + "," + carrierId;
      console.log("roomId->",roomId);
      socket.join(roomId);
      socket.emit('join chat', 'chat joined');
  })

  socket.on('chat message', async function (obj)  {
    try {
      // if(obj == undefined)
      let orderId = obj.orderId
      roomId = obj.clientId+","+obj.carrierId
			console.log("chat msg on roomId ->",roomId);
      await pool.query("INSERT INTO chats(client_id,carrier_id,order_id,message,created_at,sender) VALUES($1,$2,$3,$4,$5,$6)",
        [obj.clientId, obj.carrierId, orderId, obj.msg, getCurrentDate(), socket.userType]);
      io.to(roomId).emit('chat message', obj.msg);
    } catch (err) {
      console.log(err);
      io.to(roomId).emit('mistake', err.toString());
    }
  })


}

module.exports = {
  client: handleClient,
  carrier: handleCarrier,
  clientOrCarrier: handleBoth,
}
