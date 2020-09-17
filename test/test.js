const colors = require("colors")
const io = require('socket.io-client')
, assert = require('assert');

const {
  Pool,
  Client,
  pool
} = require("../db/index");

describe('testing socket connnections', function() {

    var client,carrier;
    const carrierId="5be02fe2-c154-4f0a-a8cf-f23414d1d20b";
    const orderId = "1826ca93-37c9-40ae-b774-986b881201af"
    const clientId = 'b7f2b98a-5b8c-4afe-9c6a-56af95359cdb';

    beforeEach(function(done) {
        // Setup
        let p = new Promise(function (resolve,reject){
          client = io.connect('http://localhost:3000?id='+clientId+'&'+
          "userType=client", {
              'reconnection delay' : 0
              , 'reopen delay' : 0
              , 'force new connection' : true
          });
          client.on('connect', function() {
              // console.log('client connected...');
              resolve()
          });


          client.on('disconnect', function() {
              // console.log('client disconnected...');
          })

        })

        carrier = io.connect('http://localhost:3000?id='+carrierId+'&'+
        "userType=carrier", {
            'reconnection delay' : 0
            , 'reopen delay' : 0
            , 'force new connection' : true
        });

        carrier.on('connect', function() {
            // console.log('carrier connected...');
            p.then(()=>{
              done();
            })
        });

        carrier.on('disconnect', function() {
            // console.log('carrier disconnected...');
        })



    });

    afterEach(function(done) {
        // Cleanup
        if(client.connected) {
            client.disconnect();
        } else {
            // There will not be a connection unless you have done() in beforeEach, client.on('connect'...)
            // console.log('client: no connection to break...');
        }

        if(carrier != undefined){
          if(carrier.connected) {
              carrier.disconnect();
          } else {
              // There will not be a connection unless you have done() in beforeEach, client.on('connect'...)
              // console.log('carrier: no connection to break...');
          }
        }
        done();
    });



    describe('testing order confirmation', function () {


        it('simulating basic procedure .. ',  function(done) {

          this.timeout(20000);
          (async function(){
            await pool.query("Update orders SET status='pending', carrier_id = NULL WHERE order_id=$1",[orderId])
          })();

          client.on("mistake", function(err) {
          //  console.log("err----->".red,err.red)
            assert.equal(true,false)
            done()
          })
          carrier.on("mistake", function(err) {
        //    console.log("err--->".red, err.red)
            assert.equal(true,false)
            done()
          })

          /* carrier connection */

          /* simulating the events */

          client.emit("currentOrder", orderId)
          client.emit("notifyCarrier", carrierId)

          carrier.on("newOrder", function(order) {
            //console.log("-carrier received order ->", order)
            assert.notEqual(order,undefined)
            client.emit("acceptCarrier", {carrierId: carrierId,waitTime: 10000})
            carrier.on("acceptOrder", function(obj){
            //  console.log("-carrier accepting order .. ")
              assert.equal(orderId,obj.orderId)
              carrier.emit("acceptOrder", {clientId: clientId, orderId: orderId})

              let one=false,two=false
              client.on("orderConfirmed",(msg)=>{
                assert.equal(msg,"done")
                one = true
              })
              carrier.on("orderConfirmed", (msg)=>{
                assert.equal(msg,"done")
                two = true
              })

              setTimeout(()=>{
                if(one && two){
                  done()
                }
                else {
                  console.error("error --> client or Carrier didn't receive confirmation".red)
                  assert.equal(true,false)
                  done()
                }
              },2000)
            })
          })

        //  ()=>client
        });

        it('client can not accept 2 carriers simultaneously ', function(done){
          this.timeout(20000);
          (async function(){
            await pool.query("Update orders SET status='pending', carrier_id = NULL WHERE order_id=$1",[orderId])
          })();

          client.on("mistake", function(err) {
            assert.equal(err,"a carrier was asked to accept the order (and only one is allowed to at a time)")
            done()
          })
          carrier.on("mistake", function(err) {
        //    console.log("err--->".red, err.red)
            assert.equal(true,false)
            done()
          })

          /* carrier connection */

          /* simulating the events */

          client.emit("currentOrder", orderId)
          client.emit("notifyCarrier", carrierId)
          client.emit("notifyCarrier", '1313232323')

          carrier.on("newOrder", function(order) {
          //  console.log("-carrier received order ->", order)
            assert.notEqual(order,undefined)
            client.emit("acceptCarrier", {carrierId: '1313232323',waitTime: 10000})
            client.emit("acceptCarrier", {carrierId: carrierId,waitTime: 10000})
          })
        })

        it('extra test', function(){
          this.timeout(20000);
          (async function(){
            await pool.query("Update orders SET status='pending', carrier_id = NULL WHERE order_id=$1",[orderId])
          })();

          client.on("mistake", function(err) {
            //assert.equal(err,"client or Carrier didn't receive confirmation")
            asset(true,false)
            done()
          })
          carrier.on("mistake", function(err) {
            //console.log("err--->".red, err.red)
            assert.equal(true,false)
            done()
          })

          /* carrier connection */

          /* simulating the events */

          client.emit("currentOrder", orderId)
          client.emit("notifyCarrier", carrierId)
          client.emit("notifyCarrier", carrierId)
          client.emit("notifyCarrier", carrierId)
          client.emit("notifyCarrier", carrierId)

        })
    });

});
