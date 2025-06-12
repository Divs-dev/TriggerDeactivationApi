const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/runTrigger', (req, res) => { 
    console.log('Code executed!');
    res.send('Hello JS code executed.');
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
