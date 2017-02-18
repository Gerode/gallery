
var async = require('async');
var gm = require('gm')
            .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');
var fs = require('fs');

// constants
var MAX_WIDTH  = 100;
var MAX_HEIGHT = 100;

function processImage(srcKey) {
    var srcBucket = "../holtfamilytree.com/reunions/images";
    var dstBucket = "test";

    var dstKey    = "resized-" + srcKey;

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function download(next) {
          console.log("download()");
          next(null, srcBucket + "/" + srcKey);
        },
            
        function transform(response, next) {
          console.log("transform(): " + response);
          gm(response).size(function(err, size) {
            console.log(size);
              // Infer the scaling factor to avoid stretching the image unnaturally.
              var scalingFactor = Math.min(
                  MAX_WIDTH / size.width,
                  MAX_HEIGHT / size.height
              );
              var width  = scalingFactor * size.width;
              var height = scalingFactor * size.height;

              // Transform the image buffer in memory.
              this.resize(width, height)
                  .toBuffer("jpg", function(err, buffer) {
                      if (err) {
                          next(err);
                      } else {
                          next(null, response.ContentType, buffer);
                      }
                  });
          });
        },
        function upload(contentType, data, next) {
          console.log("upload(): " + contentType);
          fs.writeFile(dstBucket + '/' + dstKey, data);
          next(null);
            }
        ], function (err) {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey +
                    ' and upload to ' + dstBucket + '/' + dstKey +
                    ' due to an error: ' + err
                );
            } else {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey +
                    ' and uploaded to ' + dstBucket + '/' + dstKey
                );
            }
        }
    );
}

processImage("2016_13584872_10210502083016149_2338582507920623038_o.jpeg");
