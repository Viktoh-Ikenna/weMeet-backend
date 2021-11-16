const express = require("express");
const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server, {
  pingTimeout: 180000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  upgrade: false,
  cookie: false,
});
const { v4: uuid4 } = require("uuid");
const { ExpressPeerServer } = require("peer");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
var cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");
const { promisify } = require("util");
var cookieParser = require("cookie-parser");
app.use(cookieParser());
app.set("trust proxy", true);

// app.use(cookieParser());

app.use(cors());

dotenv.config({ path: "./.env" });
const dbUrl = process.env.DATABASE_CON.replace(
  "<password>",
  process.env.DATABASE_PASS
);

console.log(process.env.NODE_ENV)

io.origins((origin, callback) => {
  let url;
  if(process.env.NODE_ENV==="development"){
    url="http://localhost:3000";
  }else{
    url="https://wemeet-6ad38.web.app";
  }
  
  // console.log(origin)
  if (origin !== url) {
    return callback("origin not allowed", false);
  }
  callback(null, true);
});


//applying middlewares

app.use(express.json());

//connecting to the db
mongoose
  .connect(dbUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("successfully connected to the database"));

const GoogleSignupSchema = new mongoose.Schema({
  FullName: String,
  Email: String,
  uid: String,
  image: String,
  password: String,
});
const UserSchema = new mongoose.Schema({
  FullName: String,
  Email: String,
  password: String,
});
const MeetingSchema = new mongoose.Schema({
  id: String,
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "Google" },
  participant: [
    {
      FullName: String,
      email: String,
      approved: Boolean,
      id: String,
    },
  ],
  startTime: String,
  duration: String,
  day: String,
  pm: String,
  password: String,
});

const google = mongoose.model("Google", GoogleSignupSchema);
const user = mongoose.model("User", UserSchema);
const Meeting = mongoose.model("Meeting", MeetingSchema);

// ||==============================================||
// ||                                              ||
// ||               for webRTC connection          ||                   ||
// ||==============================================||                                              ||

const peerServer = ExpressPeerServer(server, {
  debug: true,
});

app.use("/peerjs", peerServer);

// ||==============================================||
// ||                                              ||
// ||               Routs     ||                   ||
// ||==============================================||
//checking for logged in users..........
//check logged in ..

const checklogged = async (req, res, next) => {
  try {
    const decode = await promisify(jwt.verify)(
      req.headers.token,
      process.env.TOKEN_KEY
    );
    //   console.log('decode',decode)
    const user = await google.findOne({ uid: decode.id });
    //   console.log('user',user)
    req.user = user;
  } catch (err) {}

  next();
};

const router = express.Router();

app.get("/", checklogged, (req, res) => {
  if (req.user) {
    res.json({ state: true });
    // res.redirect(`/${uuid4()}`);
  } else {
    res.json({ state: false });
  }
});

// app.get("/login",checklogged, (req, res) => {

//     if(req.user){
//         res.redirect(`/`);

//     }else{
//         res.render("loginPage", { id: req.params.roomId });
//     }

//   });

app.get("/userData", checklogged, (req, res) => {
  try {
    if (req.user) {
      res.json({ user: req.user });
    }
  } catch (error) {
    res.json({ state: "failed", data: error });
  }
});

////creating and joing a meeting ..............
app.post("/create", checklogged, async (req, res) => {
  try {
    if (req.user) {
      // console.log(req.body)
      const roomId = uuid4();
      const createMeeting = await Meeting.create({
        id: roomId,
        admin: req.user._id,
        ...req.body,
      });
      res.json({ details: createMeeting });
    } else {
      res.json({ details: { id: "/login" } });
    }
  } catch (error) {
    res.send(`${error}`);
  }
});

app.get("/meetingDetails/:id", checklogged, async (req, res) => {
  try {
    if (req.user) {
      // console.log(req.user)
      const roomId = req.params.id;
      const meetings = await Meeting.findOne({ id: roomId });
      if(meetings){
        res.json({ data: meetings });
      }else{
        res.json({ data: 'invalid' });
      }
      // console.log(meetings)
      
    } else {
      res.json({ data: "not valid id" });
      console.log("no user");
    }
  } catch (error) {
    res.json({ data: "not valid id" });
  }
});

app.get("/join/:roomId", checklogged, async (req, res) => {
  try {
    if (req.user) {
      const { _id: id, name, Email: email } = req.user;
      const roomId = req.params.roomId;
      const meetings = await Meeting.findOne({ id: roomId });
      //  console.log(meetings)
      if (meetings) {
        if (meetings.participant.some((el) => el.email === email)) {
          res.json({ details: meetings.id });
        } else {
          meetings.participant = [
            ...meetings.participant,
            { approved: false, email, name, id },
          ];
          meetings.save();
          res.json({ details: meetings.id });
        }
      } else {
        res.json({ details: "Meetings doesnt exists" });
      }
    } else {
      res.json({ details: "no user" });
    }
  } catch (error) {
    res.send(`${error}`);
  }
});

// app.get("/:roomId",checklogged,(req,res) => {
//   try {
//     if(req.user){
//       res.render("index", { id: req.params.roomId });
//   }else{
// res.redirect(`/login`);
//   }
//   } catch (error) {
//     res.send(`${error}`);
//   }

// });

// ||==============================================||
// ||                                              ||
// ||              for Oauth                       ||
// ||==============================================||

//google
app.post("/google", async (req, res) => {
  try {
    const {
      email: Email,
      displayName: FullName,
      screenName: FullNameG,
      photoUrl: image,
      localId: uid,
      password

    } = req.body;
    //   console.log(Email, FullName || FullNameG, image, uid);
    const savedGoogle = await google.create({ Email, FullName, image, uid ,password});
    const token = await jwt.sign(
      { id: savedGoogle.uid },
      process.env.TOKEN_KEY,
      {
        expiresIn: "90d",
      }
    );

    ///setting tokens
    res.cookie("token", token, {
      // domain: '.blogfrontend-6366e.web.app',
      // domain:".localhost:3000",
      // path:"/admin-login",
      httpOnly: true,
      secure: false,
      expires: new Date(Date.now() + 600000 * 50),
    });
    //   res.redirect(`/conference/${uuid4()}`);
    res.json({ state: "success", url: `/conference/${uuid4()}`, token });
  } catch (error) {
    res.json({ state: "failed" });
  }
});

app.get("/google/:id", async (req, res) => {
  try {
    console.log(req.params.id);
    const user = await google.findOne({ uid: req.params.id });
    console.log(user);
    if (user) {
      const token = await jwt.sign({ id: user.uid }, process.env.TOKEN_KEY, {
        expiresIn: "90d",
      });
      res.cookie("token", token, {
        // domain: '.blogfrontend-6366e.web.app',
        // domain:".localhost:3000",
        // path:"/admin-login",
        httpOnly: true,
        secure: false,
        expires: new Date(Date.now() + 600000 * 50),
      });
      res.json({
        state: "existing",
        url: `/conference/${uuid4()}`,
        data: token,
      });
    } else {
      res.json({ state: "save" });
    }
  } catch (error) {
    res.json({ state: "failed" });
  }
});

//CHECK EXISTING BY EMAIL...

app.get("/google-email/:email", async (req, res) => {
  try {
    const user = await google.findOne({ Email:req.params.email });
    if (user) {
      res.json({
        state: "existing",
      });
    } else {
      res.json({ state: "save" });
    }
  } catch (error) {
    res.json({ state: "failed" });
  }
});

//LOGININ IN WITH PASSSWORD...

app.post("/loging-w-pass/", async (req, res) => {
  try {
    console.log(req.body.password);
    let password=req.body.password;
    let Email=req.body.email;
    const user = await google.findOne({ Email, password });
  
    if (user) {
      const token = await jwt.sign({ id: user.uid }, process.env.TOKEN_KEY, {
        expiresIn: "90d",
      });
      res.json({
        state: "existing",
        token
      });
    } else {
      res.json({ state: "save" });
    }
  } catch (error) {
    res.json({ state: "failed" });
  }
});


/// for facebook
app.post("/facebook", async (req, res) => {
  try {
    const {
      email: Email,
      displayName: FullName,
      photoUrl: image,
      localId: uid,
    } = req.body;
    const savedGoogle = await google.create({ Email, FullName, image, uid });
    res.json({ state: "success", data: savedGoogle });
  } catch (error) {
    res.json({ state: "failed", data: error });
  }
});

app.use("/api", router);

const port = process.env.PORT || 4000;
server.listen(port, () => console.log("our server have started"));

io.on("connection", (socket) => {
  // console.log('id',socket.id)

  socket.on("join-room", (roomID, userId,video,audio) => {
    console.log('room',roomID)
    // console.log("video", video);
    socket.join(roomID);
    socket.to(roomID).emit("user-connected", userId,video,audio);
    socket.emit("prepareData");
    socket.on("sent-message", () => {
      socket.to(roomID).emit("update-message", roomID);
    });
  });
socket.on('peerDisconnect',(data)=>{
  console.log("peerdisc",data)
})
  socket.on('disconnect',(reason)=>{
// console.log(reason," ",socket.id)
  })
});
