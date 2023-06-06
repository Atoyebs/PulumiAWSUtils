import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { PORTS } from "../types";
var ECSFargateCluster = /** @class */ (function () {
    function ECSFargateCluster(props) {
        var stage = getCorrectStage(props === null || props === void 0 ? void 0 : props.stage);
        this.stage = stage;
        // Get an existing domain Certificate
        this.certificate = aws.acm.getCertificateOutput({
            domain: props.certificateDomain,
            statuses: ["ISSUED"],
        });
        this.combinedResourcesArray = props.combinedResources;
        var vpc = new awsx.ec2.DefaultVpc("".concat(props.resourceNamingPrefix, "-").concat(stage, "-vpc"));
        // Create an application load balancer with SSL support.
        this.applicationLoadBalancer = new awsx.lb.ApplicationLoadBalancer("".concat(props.resourceNamingPrefix, "-").concat(stage, "-lb"), {});
        var loadBalancerArn = this.applicationLoadBalancer.loadBalancer.arn;
        var combinedResources = {};
        var httpsListener = ECSFargateCluster.setupHttpsListener("https-listener-".concat(stage), loadBalancerArn, this.certificate.arn);
        //store all target groups in a map for easy access via its name
        props.combinedResources.forEach(function (_a) {
            var name = _a.name, port = _a.port;
            var containerTargetGroup = new aws.lb.TargetGroup("".concat(name, "-").concat(stage, "-tg"), {
                port: port,
                protocol: "HTTP",
                targetType: "ip",
                vpcId: vpc.vpcId,
            });
            combinedResources[name] = {
                targetGroup: containerTargetGroup,
                internalPort: port,
                listenerRule: new aws.lb.ListenerRule("".concat(name, "-").concat(stage, "-rule"), {
                    actions: [{ type: "forward", targetGroupArn: containerTargetGroup.arn }],
                    conditions: [{ hostHeader: { values: ["".concat(name, "-").concat(stage, ".").concat(props.certificateDomain)] } }],
                    listenerArn: httpsListener.arn,
                }),
            };
        });
        this.combinedResources = combinedResources;
        // An ECS cluster to deploy into
        this.cluster = new aws.ecs.Cluster(props.clusterName, {}, { dependsOn: [vpc] });
    }
    /**
     *  A static function to retrieve a certificate from ACM (Amazon Certificate Manager) based on its associated domain name
     *  @param {string} domain - The associated domain name of the certificate
     *  @returns {string} An AWS ACM Certificate ARN
     *
     */
    ECSFargateCluster.getACMCertificateARN = function (domain) {
        // Get an existing domain Certificate
        var certificate = aws.acm.getCertificateOutput({
            domain: domain,
            statuses: ["ISSUED"],
        });
        return certificate.arn;
    };
    /**
     * A static function to setup an HTTPS listener for your ECS or Fargate Load Balancer. This is important
     * as this implementation will only work if you have a valid certificate to use, preferably one from
     * AWS' ACM
     *
     * @param {string} listenerName - The name/id of the listener.
     * @param {string} loadBalancerArn - The ARN (Amazon Resource Name) of the load balancer.
     * @param {string} certificateArn - The ARN of the SSL/TLS certificate.
     * @returns {aws.lb.Listener} An aws listener
     */
    ECSFargateCluster.setupHttpsListener = function (listenerName, loadBalancerArn, certificateArn) {
        return new aws.lb.Listener(listenerName, {
            loadBalancerArn: loadBalancerArn,
            port: PORTS.SSH,
            protocol: "HTTPS",
            certificateArn: certificateArn,
            defaultActions: [
                {
                    type: "fixed-response",
                    fixedResponse: {
                        contentType: "text/plain",
                        messageBody: "Fixed response content",
                        statusCode: "200",
                    },
                },
            ],
        });
    };
    /**
     * An instance version of the static function (setupHttpsListener)
     * This will setup an HTTPS listener for your ECS or Fargate Load Balancer using the certificate and load balancer set up for this instance.
     * AWS' ACM
     *
     * @param {string} listenerName - The name/id of the listener.
     * @returns {aws.lb.Listener} An aws listener
     */
    ECSFargateCluster.prototype.setupHttpsListener = function (listenerName) {
        return ECSFargateCluster.setupHttpsListener(listenerName, this.applicationLoadBalancer.loadBalancer.arn, this.certificate.arn);
    };
    /**
     * Adds a service to the already configured to manage the spinning up and
     * lifecycle of the defined task. This service will be added to the cluster that was
     * created at the instantiation of the ECSFargateCluster class. This function should only be used
     * with a particular ECSFargate instance
     *
     * @returns {awsx.ecs.FargateService} An ECS Fargate service object
     */
    ECSFargateCluster.prototype.addServiceToCluster = function (props) {
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
            portMappings: [
                {
                    containerPort: associatedPort,
                    hostPort: associatedPort,
                    targetGroup: associatedTargetGroup,
                },
            ],
        };
        var fargateService = new awsx.ecs.FargateService("service-".concat(props.name, "-").concat(this.stage), {
            cluster: this.cluster.arn,
            desiredCount: desiredCount,
            continueBeforeSteadyState: true,
            assignPublicIp: true,
            taskDefinitionArgs: { containers: containers },
            loadBalancers: [
                {
                    targetGroupArn: associatedTargetGroup === null || associatedTargetGroup === void 0 ? void 0 : associatedTargetGroup.arn,
                    containerName: props.name,
                    containerPort: associatedPort,
                },
            ],
        });
        return fargateService;
    };
    ECSFargateCluster.createRoute53SubdomainRecords = function (fargateResourceArray, loadBalancer, hostedZoneId, baseDomain, stage) {
        var aStage = getCorrectStage(stage);
        var urls = {};
        fargateResourceArray.forEach(function (fargateResource) {
            var name = fargateResource.name;
            var domain = ECSFargateCluster.createRoute53SubdomainRecord(fargateResource, loadBalancer, hostedZoneId, baseDomain, aStage);
            urls[name] = domain;
        });
        return urls;
    };
    ECSFargateCluster.createRoute53SubdomainRecord = function (fargateResource, loadBalancer, hostedZoneId, baseDomain, stage) {
        var name = fargateResource.name;
        var aStage = getCorrectStage(stage);
        var domainUrl = getServiceDomainUrl(name, baseDomain, aStage);
        new aws.route53.Record("".concat(name, "-").concat(aStage, "-subdomain"), {
            name: domainUrl,
            type: "A",
            aliases: [
                {
                    name: loadBalancer.loadBalancer.dnsName,
                    zoneId: loadBalancer.loadBalancer.zoneId,
                    evaluateTargetHealth: true,
                },
            ],
            zoneId: hostedZoneId,
        });
        return domainUrl;
    };
    ECSFargateCluster.prototype.createRoute53SubdomainRecords = function (hostedZoneId, baseDomain, stage) {
        var result = ECSFargateCluster.createRoute53SubdomainRecords(this.combinedResourcesArray, this.applicationLoadBalancer, hostedZoneId, baseDomain, stage);
        return result;
    };
    return ECSFargateCluster;
}());
export { ECSFargateCluster };
//========================================== HELPER FUNCTIONS ======================================
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
    var url = isProduction
        ? "".concat(serviceName, ".").concat(baseDomain)
        : "".concat(serviceName, "-").concat(aStage, ".").concat(baseDomain);
    return url;
}
