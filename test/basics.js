/* jshint node: true */

/* global describe: false, before: false, after: false, it: false */
'use strict';

var STAN = require('../lib/stan'),
ssc = require('./support/stan_server_control'),
nuid = require('../lib/nuid'),
should = require('should'),
timers = require('timers');


describe('Basics', function () {

  var cluster = 'test-cluster';
  var PORT = 1423;
  var uri = 'nats://localhost:' + PORT;
  var server;

  // Start up our own streaming
  before(function (done) {
    server = ssc.start_server(PORT, function () {
      timers.setTimeout(function () {
        done();
      }, 250);
    });
  });

  // Shutdown our server after we are done
  after(function () {
    //noinspection JSUnresolvedFunction
    server.kill();
  });

  it('should do basic subscribe and unsubscribe', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var didReady = false;
    stan.on('connect', function () {
      var so = stan.subscriptionOptions();
      so.setStartAt(STAN.StartPosition.FIRST);
      var sub = stan.subscribe('foo', so);
      sub.on('error', function (err) {
        should.fail(err, null, 'Error handler was called');
      });
      sub.on('ready', function () {
        didReady = true;
        sub.subject.should.be.equal('foo');
        should.not.exist(sub.qGroup);
        should.exist(sub.inbox);
        should.exist(sub.ackInbox);
        should.exist(sub.inboxSub);
        sub.unsubscribe();
      });
      sub.on('unsubscribed', function () {
        done();
      });
    });
  });

  it('subscription options should allow chaining', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      var so = stan.subscriptionOptions();
      so.setStartAt(STAN.StartPosition.FIRST).should.be.equal(so);
      so.setMaxInFlight(100).should.be.equal(so);
      so.setAckWait(1000).should.be.equal(so);
      so.setStartAt(1000).should.be.equal(so);
      so.setStartAtSequence(1000).should.be.equal(so);
      so.setStartTime(new Date()).should.be.equal(so);
      so.setStartAtTimeDelta(1000).should.be.equal(so);
      so.setStartWithLastReceived().should.be.equal(so);
      so.setDeliverAllAvailable().should.be.equal(so);
      so.setManualAckMode(true).should.be.equal(so);
      so.setDurableName('foo').should.be.equal(so);
      done();
    });
  });

  it('should do publish', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var connected = false;
    stan.on('connect', function () {
      connected = true;
      var sid = stan.publish('foo', "bar", function (err, guid) {
        should.exist(guid);
        guid.should.be.equal(sid);
        should.not.exist(err);
        done();
      });
    });
  });

  it('should do basic publish (only pub)', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      var subject = nuid.next();
      stan.publish(subject, 'bzz', function (err, guid) {
        should.not.exist(err);
        should.exist(guid);
        stan.close();
        done();
      });
    });
  });


  it('should fire a callback for subscription', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      var so = stan.subscriptionOptions();
      so.setStartAt(STAN.StartPosition.NEW_ONLY);
      var subject = nuid.next();
      var sub = stan.subscribe(subject, so);
      sub.on('ready', function () {
        stan.publish(subject, 'foo', function (err, guid) {
          should.not.exist(err);
          should.exist(guid);
        });
      });
      sub.on('unsubscribed', function () {
        done();
        stan.close();
      });
      sub.on('message', function (msg) {
        sub.unsubscribe();
      });
    });
  });

  it('duplicate client id should fire error', function (done) {
    var wantTwo = 2;
    var id = nuid.next();
    var stan = STAN.connect(cluster, id, PORT);
    stan.on('connect', function () {
      var stan2 = STAN.connect(cluster, id, PORT);
      stan2.on('error', function() {
        wantTwo--;
        if (wantTwo === 0) {
          done();
        }
      });
      stan2.on('close', function() {
        wantTwo--;
        if (wantTwo === 0) {
          done();
        }
      });
    });
  });

  it('should include the correct message in the callback', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      var subject = nuid.next();
      var so = stan.subscriptionOptions();
      so.setStartAt(STAN.StartPosition.FIRST);
      var sub = stan.subscribe(subject, so);
      sub.on('message', function (m) {
        m.getSubject().should.be.equal(subject);
        sub.unsubscribe();
      });
      sub.on('unsubscribed', function () {
        stan.close();
        done();
      });
      stan.publish(subject);
    });
  });



  it('should include the correct reply in the callback', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var count = 0;

    function maybeFinish() {
      if (count === 2) {
        count++;
        done();
      }
    }

    stan.on('connect', function () {
      var subja = nuid.next();
      var subjb = nuid.next();
      var so = stan.subscriptionOptions();
      so.setStartAt(STAN.StartPosition.FIRST);
      var sub1 = stan.subscribe(subja, so);
      sub1.on('message', function (m) {
        m.getSubject().should.be.equal(subja);
        sub1.unsubscribe();
        count++;
      });
      sub1.on('unsubscribed', function () {
        maybeFinish();
      });

      var sub2 = stan.subscribe(subjb, so);
      sub2.on('message', function (m) {
        m.getSubject().should.be.equal(subjb);
        sub2.unsubscribe();
        count++;
      });
      sub2.on('unsubscribed', function () {
        maybeFinish();
      });

      stan.publish(subja);
      stan.publish(subjb);
    });
  });


  it('should error if unsubscribe after close of connection', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var sub;
    stan.on('connect', function () {
      sub = stan.subscribe(nuid.next());
      sub.on('ready', function () {
        stan.close();
      });
      sub.on('error', function (e) {
        e.message.should.containEql('Connection closed');
        done();
      });
    });

    stan.on('close', function () {
      sub.unsubscribe();
    });
  });


  it('should not receive data after unsubscribe call', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var received = 0;
    var published = 0;

    function maybeFinish() {
      published++;
      if (published === 3) {
        should(received).be.equal(1);
        done();
      }
    }

    stan.on('connect', function () {
      var req = nuid.next();

      var so = stan.subscriptionOptions();
      so.setStartAt(STAN.StartPosition.FIRST);
      // subscriber for request, replies on the specified subject
      var sub = stan.subscribe(req, so);
      sub.on('ready', function () {
        stan.publish(req, '', maybeFinish);
        stan.publish(req, '', maybeFinish);
        stan.publish(req, '', maybeFinish);
      });
      sub.on('message', function (m) {
        received++;
        sub.unsubscribe();
      });
    });
  });


  it('publish cb is error if not connected', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      stan.close();
    });
    stan.on('close', function () {
      stan.publish('foo', 'bar', function (error) {
        if (error instanceof Error) {
          done();
        }
      });
    });
  });

  it('publish throws error if not connected', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      stan.close();
    });
    stan.on('close', function () {
      try {
        stan.publish('foo', 'bar');
      } catch (error) {
        done();
      }
    });
  });


  it('maxPubAcksInflight should cb on error', function (done) {
    var opts = {maxPubAcksInflight: 3, uri: uri};
    var stan = STAN.connect(cluster, nuid.next(), opts);
    var failed = false;
    stan.on('connect', function () {
      var cb = function (err) {
        if (failed) return;
        if (err) {
          if (err.message === 'stan: max in flight reached.') {
            failed = true;
            done();
          }
        }
      };

      for (var i = 0; i < 10; i++) {
        stan.publish(nuid.next(), 'bar', cb);
      }
    });
  });

  it('maxPubAcksInflight should toss on error', function (done) {
    var opts = {maxPubAcksInflight: 3, uri: uri};
    var stan = STAN.connect(cluster, nuid.next(), opts);
    var buf = new Buffer('HelloWorld', 'utf8');
    var failed = false;
    stan.on('connect', function () {
      for (var i = 0; i < 10; i++) {
        try {
          stan.publish(nuid.next(), buf);
        } catch (err) {
          if (!failed) {
            if (err.message === 'stan: max in flight reached.') {
              failed = true;
              done();
            }
          }
        }
      }
    });
  });

  it('subscribe requires subject', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      stan.subscribe(undefined);
    });
    stan.on('error', function (err) {
      if (err.message === 'stan: subject must be supplied') {
        done();
      }
    });
  });

  it('subscribe requires a connection', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      stan.close();
    });
    stan.on('close', function (err) {
      stan.subscribe(nuid.next());
    });
    stan.on('error', function (err) {
      if (err.message === 'stan: Connection closed') {
        done();
      }
    });
  });


  it('subscribe emits ready', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      var sub = stan.subscribe(nuid.next());
      sub.on('ready', function () {
        sub.unsubscribe();
      });
      sub.on('unsubscribed', function () {
        done();
      });
    });
  });

  it('subscribe twice is invalid', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      var sub = stan.subscribe(nuid.next());
      sub.on('ready', function () {
        sub.unsubscribe();
      });
      sub.on('unsubscribed', function () {
        sub.unsubscribe();
      });
      sub.on('error', function (err) {
        if (err.message === 'stan: invalid subscription') {
          done();
        }
      });
    });
  });

  it('subscribe starting on second', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var subj = nuid.next();
    var count = 0;

    function subscribe() {
      var gotFirst = false;
      var opts = stan.subscriptionOptions();
      opts.setStartAtSequence(2);
      var sub = stan.subscribe(subj, opts);
      sub.on('message', function (msg) {
        if (!gotFirst) {
          gotFirst = true;
          should(msg.getData()).equal('second', 'second message was not the one expected');
          done();
        }
      });
    }

    var waitForThree = function () {
      count++;
      if (count === 3) {
        process.nextTick(subscribe);
      }
    };

    stan.on('connect', function () {
      stan.publish(subj, 'first', waitForThree);
      stan.publish(subj, 'second', waitForThree);
      stan.publish(subj, 'third', waitForThree);
    });
  });

  it('subscribe starting on last received', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var subj = nuid.next();
    var count = 0;

    function subscribe() {
      var gotFirst = false;
      var opts = stan.subscriptionOptions();
      opts.setStartWithLastReceived();
      var sub = stan.subscribe(subj, opts);
      sub.on('message', function (msg) {
        if (!gotFirst) {
          gotFirst = true;
          should(msg.getData()).equal('third', 'second message was not the one expected');
          done();
        }
      });

    }

    var waitForThree = function () {
      count++;
      if (count === 3) {
        process.nextTick(subscribe);
      }
    };

    stan.on('connect', function () {
      stan.publish(subj, 'first', waitForThree);
      stan.publish(subj, 'second', waitForThree);
      stan.publish(subj, 'third', waitForThree);
    });
  });


  it('subscribe after 500ms on last received', function (done) {
    this.timeout(5000);
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var subj = nuid.next();
    var count = 0;

    function subscribe() {
      var gotFirst = false;
      var opts = stan.subscriptionOptions();
      opts.setStartAtTimeDelta(1000);
      var sub = stan.subscribe(subj, opts);
      sub.on('message', function (msg) {
        if (!gotFirst) {
          gotFirst = true;
          should(msg.getData()).equal('fourth', 'message was not the one expected');
          done();
        }
      });
    }

    var waitForSix = function () {
      count++;
      if (count === 6) {
        process.nextTick(subscribe);
      }
    };

    stan.on('connect', function () {
      stan.publish(subj, 'first', waitForSix);
      stan.publish(subj, 'second', waitForSix);
      stan.publish(subj, 'third', waitForSix);
      setTimeout(function() {
        stan.publish(subj, 'fourth', waitForSix);
        stan.publish(subj, 'fifth', waitForSix);
        stan.publish(subj, 'sixth', waitForSix);
      }, 1500);
    });
  });



  it('subscribe after a specific time on last received', function (done) {
    this.timeout(6000);
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var subj = nuid.next();
    var count = 0;

    function subscribe() {
      var gotFirst = false;
      var opts = stan.subscriptionOptions();
      opts.setStartTime(new Date(Date.now() - 1000));
      var sub = stan.subscribe(subj, opts);
      sub.on('message', function (msg) {
        if (!gotFirst) {
          gotFirst = true;
          // node will be spurious since we are in a single thread
          var ok = msg.getData() === 'fourth' || msg.getData() === 'fifth' || msg.getData() === 'sixth';
          should(ok).equal(true, 'message was not the one expected');
          done();
        }
      });
    }

    var waitForSix = function () {
      count++;
      if (count === 6) {
        process.nextTick(subscribe);
      }
    };

    stan.on('connect', function () {
      stan.publish(subj, 'first', waitForSix);
      stan.publish(subj, 'second', waitForSix);
      stan.publish(subj, 'third', waitForSix);
      setTimeout(function() {
        stan.publish(subj, 'fourth', waitForSix);
        stan.publish(subj, 'fifth', waitForSix);
        stan.publish(subj, 'sixth', waitForSix);
      }, 1500);
    });
  });

  it('subscribe starting on new', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var subj = nuid.next();
    var count = 0;

    function subscribe() {
      var gotFirst = false;
      var opts = stan.subscriptionOptions();
      opts.setStartAt(STAN.StartPosition.NEW_ONLY);
      var sub = stan.subscribe(subj, opts);
      sub.on('message', function (msg) {
        if (!gotFirst) {
          gotFirst = true;
          msg.getData().should.be.equal('fourth');
          done();
        }
      });

      sub.on('ready', function () {
        stan.publish(subj, 'fourth');
      });
    }

    var waitForThree = function () {
      count++;
      if (count === 3) {
        process.nextTick(subscribe);
      }
    };

    stan.on('connect', function () {
      stan.publish(subj, 'first', waitForThree);
      stan.publish(subj, 'second', waitForThree);
      stan.publish(subj, 'third', waitForThree);
    });
  });


  it('subscribe all available', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var subj = nuid.next();
    var count = 0;

    function subscribe() {
      var gotFirst = false;
      var opts = stan.subscriptionOptions();
      opts.setDeliverAllAvailable();
      var sub = stan.subscribe(subj, opts);
      sub.on('message', function (msg) {
        msg.getTimestamp().getTime().should.be.equal(parseInt(msg.getTimestampRaw() / 1000000));
        msg.isRedelivered().should.be.equal(false);
        var buf = msg.getRawData();
        buf.length.should.be.greaterThan(0);

        if (!gotFirst) {
          gotFirst = true;

          should(msg.getData()).equal('first', 'second message was not the one expected');
          done();
        }
      });
    }

    var waitForThree = function () {
      count++;
      if (count === 3) {
        process.nextTick(subscribe);
      }
    };

    stan.on('connect', function () {
      stan.publish(subj, 'first', waitForThree);
      stan.publish(subj, 'second', waitForThree);
      stan.publish(subj, 'third', waitForThree);
    });
  });


  it('queues should work', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var subj = nuid.next();
    stan.on('connect', function () {

      var subsready = 0;
      var a = 0;
      var b = 0;
      var opts = stan.subscriptionOptions();
      opts.setDeliverAllAvailable();
      var suba = stan.subscribe(subj, 'queue', opts);
      var subb = stan.subscribe(subj, 'queue', opts);

      suba.on('message', function (msg) {
        a++;
        if ((a + b) === 10) {
          done();
        }
      });

      subb.on('message', function (msg) {
        b++;
        if ((a + b) === 10) {
          done();
        }
      });

      suba.on('ready', function () {
        subsready++;
        if (subsready === 2) {
          fire();
        }
      });

      subb.on('ready', function () {
        subsready++;
        if (subsready === 2) {
          fire();
        }
      });

      function fire() {
        for (var i = 0; i < 10; i++) {
          stan.publish(subj, i + '');
        }
      }
    });
  });


  it('durables should work', function (done) {
    var clientID = nuid.next();
    var subj = nuid.next();

    var stan = STAN.connect(cluster, clientID, PORT);
    var opts = stan.subscriptionOptions();
    opts.setDeliverAllAvailable();
    opts.setManualAckMode(true);
    opts.setDurableName('my-durable');

    stan.on('connect', function () {
      var sub1 = stan.subscribe(subj, opts);
      sub1.on('ready', function () {
        for(var i=0; i < 2; i++) {
          stan.publish(subj);
        }
      });

      var count = 0;
      sub1.on('message', function (msg) {
        count++;
        if(count < 2) {
          msg.ack();
        }
        if(count === 2) {
          setTimeout(function() {
            stan.close();
          }, 100);
        }
      });
    });

    stan.on('close', function() {
      var stan2 = STAN.connect(cluster, clientID, PORT);
      stan2.on('connect', function() {
        var sub2 = stan2.subscribe(subj, opts);
        var second = false;
        sub2.on('message', function(msg) {
          if(!second) {
            second = true;
            msg.getSequence().should.be.equal(2);
            stan2.close();
            done();
          }
        });
      });
    });
  });
});
