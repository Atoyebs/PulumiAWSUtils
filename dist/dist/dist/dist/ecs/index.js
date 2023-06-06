"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ECSFargateCluster = void 0;
var aws = _interopRequireWildcard(require("@pulumi/aws"));
var awsx = _interopRequireWildcard(require("@pulumi/awsx"));
var _types = require("../types");
function _getRequireWildcardCache(nodeInterop) {
  if (typeof WeakMap !== "function") return null;
  var cacheBabelInterop = new WeakMap();
  var cacheNodeInterop = new WeakMap();
  return (_getRequireWildcardCache = function _getRequireWildcardCache(nodeInterop) {
    return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
  })(nodeInterop);
}
function _interopRequireWildcard(obj, nodeInterop) {
  if (!nodeInterop && obj && obj.__esModule) {
    return obj;
  }
  if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") {
    return {
      "default": obj
    };
  }
  var cache = _getRequireWildcardCache(nodeInterop);
  if (cache && cache.has(obj)) {
    return cache.get(obj);
  }
  var newObj = {};
  var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
  for (var key in obj) {
    if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
      var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
      if (desc && (desc.get || desc.set)) {
        Object.defineProperty(newObj, key, desc);
      } else {
        newObj[key] = obj[key];
      }
    }
  }
  newObj["default"] = obj;
  if (cache) {
    cache.set(obj, newObj);
  }
  return newObj;
}
function _typeof(obj) {
  "@babel/helpers - typeof";

  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj) {
    return typeof obj;
  } : function (obj) {
    return obj && "function" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
  }, _typeof(obj);
}
function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}
function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor) descriptor.writable = true;
    Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor);
  }
}
function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps) _defineProperties(Constructor.prototype, protoProps);
  if (staticProps) _defineProperties(Constructor, staticProps);
  Object.defineProperty(Constructor, "prototype", {
    writable: false
  });
  return Constructor;
}
function _toPropertyKey(arg) {
  var key = _toPrimitive(arg, "string");
  return _typeof(key) === "symbol" ? key : String(key);
}
function _toPrimitive(input, hint) {
  if (_typeof(input) !== "object" || input === null) return input;
  var prim = input[Symbol.toPrimitive];
  if (prim !== undefined) {
    var res = prim.call(input, hint || "default");
    if (_typeof(res) !== "object") return res;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (hint === "string" ? String : Number)(input);
}
var ECSFargateCluster = /*#__PURE__*/function () {
  function ECSFargateCluster(props) {
    _classCallCheck(this, ECSFargateCluster);
    var stage = getCorrectStage(props === null || props === void 0 ? void 0 : props.stage);
    this.stage = stage; // Get an existing domain Certificate
    this.certificate = aws.acm.getCertificateOutput({
      domain: props.certificateDomain,
      statuses: ["ISSUED"]
    });
    this.combinedResourcesArray = props.combinedResources;
    var vpc = new awsx.ec2.DefaultVpc("".concat(props.resourceNamingPrefix, "-").concat(stage, "-vpc")); // Create an application load balancer with SSL support.
    this.applicationLoadBalancer = new awsx.lb.ApplicationLoadBalancer("".concat(props.resourceNamingPrefix, "-").concat(stage, "-lb"), {});
    var loadBalancerArn = this.applicationLoadBalancer.loadBalancer.arn;
    var combinedResources = {};
    var httpsListener = ECSFargateCluster.setupHttpsListener("https-listener-".concat(stage), loadBalancerArn, this.certificate.arn); //store all target groups in a map for easy access via its name
    props.combinedResources.forEach(function (_ref) {
      var name = _ref.name,
        port = _ref.port;
      var containerTargetGroup = new aws.lb.TargetGroup("".concat(name, "-").concat(stage, "-tg"), {
        port: port,
        protocol: "HTTP",
        targetType: "ip",
        vpcId: vpc.vpcId
      });
      combinedResources[name] = {
        targetGroup: containerTargetGroup,
        internalPort: port,
        listenerRule: new aws.lb.ListenerRule("".concat(name, "-").concat(stage, "-rule"), {
          actions: [{
            type: "forward",
            targetGroupArn: containerTargetGroup.arn
          }],
          conditions: [{
            hostHeader: {
              values: ["".concat(name, "-").concat(stage, ".").concat(props.certificateDomain)]
            }
          }],
          listenerArn: httpsListener.arn
        })
      };
    });
    this.combinedResources = combinedResources; // An ECS cluster to deploy into
    this.cluster = new aws.ecs.Cluster(props.clusterName, {}, {
      dependsOn: [vpc]
    });
  } /**
    *  A static function to retrieve a certificate from ACM (Amazon Certificate Manager) based on its associated domain name
    *  @param {string} domain - The associated domain name of the certificate
    *  @returns {string} An AWS ACM Certificate ARN
    *
    */
  _createClass(ECSFargateCluster, [{
    key: "setupHttpsListener",
    value:
    /**
    * An instance version of the static function (setupHttpsListener)
    * This will setup an HTTPS listener for your ECS or Fargate Load Balancer using the certificate and load balancer set up for this instance.
    * AWS' ACM
    *
    * @param {string} listenerName - The name/id of the listener.
    * @returns {aws.lb.Listener} An aws listener
    */
    function setupHttpsListener(listenerName) {
      return ECSFargateCluster.setupHttpsListener(listenerName, this.applicationLoadBalancer.loadBalancer.arn, this.certificate.arn);
    } /**
      * Adds a service to the already configured to manage the spinning up and
      * lifecycle of the defined task. This service will be added to the cluster that was
      * created at the instantiation of the ECSFargateCluster class. This function should only be used
      * with a particular ECSFargate instance
      *
      * @returns {awsx.ecs.FargateService} An ECS Fargate service object
      */
  }, {
    key: "addServiceToCluster",
    value: function addServiceToCluster(props) {
      var associatedTargetGroup = this.combinedResources[props.name].targetGroup;
      var associatedPort = this.combinedResources[props.name].internalPort;
      var containers = {};
      var desiredCount = (props === null || props === void 0 ? void 0 : props.desiredCount) === undefined || (props === null || props === void 0 ? void 0 : props.desiredCount) < 1 ? 1 : props === null || props === void 0 ? void 0 : props.desiredCount;
      containers[props.name] = {
        name: props.name,
        image: props.image,
        cpu: props.cpuSize,
        memory: props.memorySize,
        essential: props === null || props === void 0 ? void 0 : props.essential,
        environment: props === null || props === void 0 ? void 0 : props.environment,
        portMappings: [{
          containerPort: associatedPort,
          hostPort: associatedPort,
          targetGroup: associatedTargetGroup
        }]
      };
      var fargateService = new awsx.ecs.FargateService("service-".concat(props.name, "-").concat(this.stage), {
        cluster: this.cluster.arn,
        desiredCount: desiredCount,
        continueBeforeSteadyState: true,
        assignPublicIp: true,
        taskDefinitionArgs: {
          containers: containers
        },
        loadBalancers: [{
          targetGroupArn: associatedTargetGroup === null || associatedTargetGroup === void 0 ? void 0 : associatedTargetGroup.arn,
          containerName: props.name,
          containerPort: associatedPort
        }]
      });
      return fargateService;
    }
  }, {
    key: "createRoute53SubdomainRecords",
    value: function createRoute53SubdomainRecords(hostedZoneId, baseDomain, stage) {
      var result = ECSFargateCluster.createRoute53SubdomainRecords(this.combinedResourcesArray, this.applicationLoadBalancer, hostedZoneId, baseDomain, stage);
      return result;
    }
  }], [{
    key: "getACMCertificateARN",
    value: function getACMCertificateARN(domain) {
      // Get an existing domain Certificate
      var certificate = aws.acm.getCertificateOutput({
        domain: domain,
        statuses: ["ISSUED"]
      });
      return certificate.arn;
    } /**
      * A static function to setup an HTTPS listener for your ECS or Fargate Load Balancer. This is important
      * as this implementation will only work if you have a valid certificate to use, preferably one from
      * AWS' ACM
      *
      * @param {string} listenerName - The name/id of the listener.
      * @param {string} loadBalancerArn - The ARN (Amazon Resource Name) of the load balancer.
      * @param {string} certificateArn - The ARN of the SSL/TLS certificate.
      * @returns {aws.lb.Listener} An aws listener
      */
  }, {
    key: "setupHttpsListener",
    value: function setupHttpsListener(listenerName, loadBalancerArn, certificateArn) {
      return new aws.lb.Listener(listenerName, {
        loadBalancerArn: loadBalancerArn,
        port: _types.PORTS.SSH,
        protocol: "HTTPS",
        certificateArn: certificateArn,
        defaultActions: [{
          type: "fixed-response",
          fixedResponse: {
            contentType: "text/plain",
            messageBody: "Fixed response content",
            statusCode: "200"
          }
        }]
      });
    }
  }, {
    key: "createRoute53SubdomainRecords",
    value: function createRoute53SubdomainRecords(fargateResourceArray, loadBalancer, hostedZoneId, baseDomain, stage) {
      var aStage = getCorrectStage(stage);
      var urls = {};
      fargateResourceArray.forEach(function (fargateResource) {
        var name = fargateResource.name;
        var domain = ECSFargateCluster.createRoute53SubdomainRecord(fargateResource, loadBalancer, hostedZoneId, baseDomain, aStage);
        urls[name] = domain;
      });
      return urls;
    }
  }, {
    key: "createRoute53SubdomainRecord",
    value: function createRoute53SubdomainRecord(fargateResource, loadBalancer, hostedZoneId, baseDomain, stage) {
      var name = fargateResource.name;
      var aStage = getCorrectStage(stage);
      var domainUrl = getServiceDomainUrl(name, baseDomain, aStage);
      new aws.route53.Record("".concat(name, "-").concat(aStage, "-subdomain"), {
        name: domainUrl,
        type: "A",
        aliases: [{
          name: loadBalancer.loadBalancer.dnsName,
          zoneId: loadBalancer.loadBalancer.zoneId,
          evaluateTargetHealth: true
        }],
        zoneId: hostedZoneId
      });
      return domainUrl;
    }
  }]);
  return ECSFargateCluster;
}(); //========================================== HELPER FUNCTIONS ======================================
exports.ECSFargateCluster = ECSFargateCluster;
function getCorrectStage(stage) {
  return stage !== null && stage !== void 0 ? stage : "dev";
}
function getIsStageProduction(stage) {
  var lowercaseStage = getCorrectStage(stage).toLowerCase();
  var isProduction = lowercaseStage.includes("prod") || lowercaseStage.includes("live");
  return isProduction;
}
function getServiceDomainUrl(serviceName, baseDomain, stage) {
  var isProduction = getIsStageProduction(stage);
  var aStage = getCorrectStage(stage);
  var url = isProduction ? "".concat(serviceName, ".").concat(baseDomain) : "".concat(serviceName, "-").concat(aStage, ".").concat(baseDomain);
  return url;
}