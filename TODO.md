## UI
* Menubar with:
  * Selectable Region
  * Selectable AWS account – requires ability for mutliple config files server side
* Show clusters as tabbed view with one cluster per tab
* Show an exploded view of task with more details when hovering over tasks:
  * Show containers within tasks
  * Show memory breakdown across containers
* Sliding timebar to see historical data for comparison (like google street view)
* Show container actual memory utilisation vs reserved memory utilisation
* Provide access to more troubleshooting information (such as docker logs, ECS logs)
* Add footer with fetched/expiry timestamp, #instances/services/tasks, Average CPU/Memory Reservation

## Server
* Write a plugin system that lets adopters plugin their own statistics from favourite monitoring tool
* Pluggable backend system that could support other public or private cloud providers
* Return instances with FETCHED_INSTANCES FetchStatus to allow client to draw instances outline until tasks retrieved asynchronously
* Arrow functions: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions



## Testing
  * Capture ECS JSON responses for testing and replay with mock AWS ECS server
  * https://fbflex.wordpress.com/2013/11/18/mocking-out-amazon-aws-sdk-with-the-betamax-recording-proxy-for-testing/
