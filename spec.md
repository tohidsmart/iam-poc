
The intent of this spec is to write an application to authenticate and get users consent ( login and consent service) in the  boundary of ORY as the Open Source IAM eco-system. We use ory hydra as the authz server - configured in the docker compose - however we replace the consent service with our own implementation. The understanding is that  hydra redirects users to this service to authenticate and get the authorization code. The authorization code is then exchanged for access, refresh and id token . The access token contains the scope ? ( not sure) . There are other bootstrapping steps to complete the workflow such as client registration or potentially a resource server. Let's use what Ory provide out of the box and implement something custom if we have time to polish it. 

 - The tech stack is node and TypeScript. 
 - The service must follow the SOLID principles. Especially the single responsibility and inversion of control . Dependency injection helps to mock methods and write unit tests for the service which is a requirements. The expectation is that by following SOLID, we can achieve high code quality, defensive coding, and avoid code-smell. 
 - The service need to be configurable so that the end to end of the auth and authz flow can be completed with automated UI tests such as PlayWright or a script. Needless to say that service should be container-first with a Dockerfile and its best practices such as multi-stage build, strict security context, non-root user and WSGI 
 - We should not be concerned with user sign-up process and seeding the application with test users is fine as long as it follows the best practices such as config-as-data and optionally encrypted password. 
 - As the setup contains multiple sensitive credentials such as hydra salt and users password, we must consider config and secret management. I know that SOPS is a good tool for offline KMS operations but I have not used it personally. After reading about it, it appears that SOPS encrypts the entire file and requires a key after all. so back to square one of key management in the cloud. Although I am not sure if we can use PGP as KMS
 - The acceptance criteria highlights production-readiness however it says that we do not expect a finished or enterprise-grade solution.
 - Non functional requirements are things that give us the most leverage and discussion points so we need to think and apply shift-left mindset for it Security, Logging and Monitoring 
   - Security: 
     - protect hydra admin api. defining trust boundary between services. For example, login service can reach hydra and vice versa however client should not be able to reach hydra admin API.
     - What are the impact if service is compromised and what is our approach towards disaster recovery,
     - credential management for hydra sensitive values, key rotation e
   - Logging 
     - Who logged in, obtained access token, or got denied and when 
  
   - Monitoring 
     - Auth,Authz reqs / sec
     - Time to complete the flow
   - Scalability and Availability. 
     - This is POC engineering task for an interview but I should be able to defend that design is scalable and highly-available. Feel free to push back on my decisions or point out the lack of decision in this spec if they do not 
   - Document the problems solution solve, why it solve them in a specific way to show critical and trade-off thinking

Expectation : 
 - Start with refining the scope document as much as possible. Create a copy, give me feedback on how comprehensive and easy easy-to-follow this spec is for you. For context, half the reason I am doing this engineering task on my day off is to get better at spec-driven development with an coding agent.  
 - Involve human in the loop as much as possible. use AskUser tool when appropriate to drive the conversation. This help to me build the confidence and momentum for the section of the interview which interviewers throw new requirements. 

Unknown to me : 
 - Compose file has Postgres service Hydra uses. I do not have a solid understanding of the database schema, database migrations handler but task briefing asks about it. 
 - What are the purpose of the sensitive credentials in hydra.yaml 
 - I am still not sure how many types of authz can be achieved via OAuth2 e.g. machine to machine, user auth etc. I assume since task request for login and consent service implementation it is not asking for machine-to-machine flow. When the task say authorisation code flow I am not sure if it refers to human-based flow or not. 


 
 Out of the scope, 
 - CI/CD, cloud, K8s, IDP . However I think then achieving some of our security and NFR adds complexity without these, I am aware.  
            