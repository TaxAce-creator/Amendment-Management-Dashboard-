# Admin-Equivalent Role Contract

The centralized capability matrix assigns the complete Admin capability set to **Admin**, **EA Reviewer**, and **Preparer**, while retaining each user’s displayed TaxAce role label.

The protected server middleware authorizes by capability rather than by checking only for the literal `Admin` role. `Viewer` remains restricted to the approved view/export capability set.

Automated authorization tests must continue to verify that EA Reviewer and Preparer can reach `manageSettings` and `manageUsers` procedures while Viewer cannot perform write or administration actions.
