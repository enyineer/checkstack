import React, { useState } from "react";
import {
  Button,
  Input,
  Label,
  useToast,
  LoadingSpinner,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabPanel,
} from "@checkstack/ui";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { CatalogApi, type SystemContact } from "@checkstack/catalog-common";
import { AuthApi, authAccess } from "@checkstack/auth-common";
import { User, Mail, Trash2, Plus } from "lucide-react";

interface ContactsEditorProps {
  systemId: string;
}

interface UserDto {
  id: string;
  name: string;
  email: string;
}

export const ContactsEditor: React.FC<ContactsEditorProps> = ({ systemId }) => {
  const catalogClient = usePluginClient(CatalogApi);
  const authClient = usePluginClient(AuthApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  // Check if user can search users
  const { allowed: canSearchUsers, loading: accessLoading } =
    accessApi.useAccess(authAccess.users.read);

  // Form state
  const [selectedUserId, setSelectedUserId] = useState("");
  const [mailboxEmail, setMailboxEmail] = useState("");
  const [label, setLabel] = useState("");
  const [activeTab, setActiveTab] = useState("mailbox");

  // Update active tab when permission loading completes
  React.useEffect(() => {
    if (!accessLoading && canSearchUsers) {
      setActiveTab("user");
    }
  }, [accessLoading, canSearchUsers]);

  // Fetch existing contacts
  const {
    data: contacts = [],
    isLoading: contactsLoading,
    refetch: refetchContacts,
  } = catalogClient.getSystemContacts.useQuery({ systemId });

  // Fetch users for selection (only if user has permission)
  const { data: users = [] } = authClient.getUsers.useQuery(
    {},
    { enabled: canSearchUsers },
  );

  // Add contact mutation
  const addContactMutation = catalogClient.addSystemContact.useMutation({
    onSuccess: () => {
      toast.success("Contact added successfully");
      setSelectedUserId("");
      setMailboxEmail("");
      setLabel("");
      void refetchContacts();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to add contact",
      );
    },
  });

  // Remove contact mutation
  const removeContactMutation = catalogClient.removeSystemContact.useMutation({
    onSuccess: () => {
      toast.success("Contact removed");
      void refetchContacts();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove contact",
      );
    },
  });

  const handleAddUserContact = () => {
    if (!selectedUserId) {
      toast.error("Please select a user");
      return;
    }

    addContactMutation.mutate({
      systemId,
      type: "user",
      userId: selectedUserId,
      label: label.trim() || undefined,
    });
  };

  const handleAddMailboxContact = () => {
    if (!mailboxEmail.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailboxEmail.trim())) {
      toast.error("Please enter a valid email address");
      return;
    }

    addContactMutation.mutate({
      systemId,
      type: "mailbox",
      email: mailboxEmail.trim(),
      label: label.trim() || undefined,
    });
  };

  const handleRemoveContact = (contactId: string) => {
    removeContactMutation.mutate(contactId);
  };

  // Filter out users who are already contacts
  const existingUserIds = new Set(
    contacts
      .filter((c): c is SystemContact & { type: "user" } => c.type === "user")
      .map((c) => c.userId),
  );
  const availableUsers = (users as UserDto[]).filter(
    (u) => !existingUserIds.has(u.id),
  );

  // Build tab items
  const tabItems = [];
  if (canSearchUsers) {
    tabItems.push({ id: "user", label: "Add User" });
  }
  tabItems.push({ id: "mailbox", label: "Add Mailbox" });

  if (contactsLoading || accessLoading) {
    return (
      <div className="flex justify-center py-4">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Label>Contacts</Label>

      {/* Existing Contacts List */}
      {contacts.length > 0 && (
        <div className="border rounded-lg divide-y">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="flex items-center justify-between p-3"
            >
              <div className="flex items-center gap-2">
                {contact.type === "user" ? (
                  <User className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Mail className="h-4 w-4 text-muted-foreground" />
                )}
                <div>
                  <span className="text-sm">
                    {contact.type === "user"
                      ? (contact.userName ?? contact.userId)
                      : contact.email}
                  </span>
                  {contact.label && (
                    <span className="text-xs text-muted-foreground ml-2">
                      ({contact.label})
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveContact(contact.id)}
                disabled={removeContactMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {contacts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No contacts assigned yet
        </p>
      )}

      {/* Add Contact Section */}
      <div className="border rounded-lg p-4 space-y-4">
        <Tabs
          items={tabItems}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {canSearchUsers && (
          <TabPanel id="user" activeTab={activeTab} className="space-y-3 pt-3">
            <div className="space-y-2">
              <Label htmlFor="user-select">Platform User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id="user-select">
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      No available users
                    </SelectItem>
                  ) : (
                    availableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name} ({user.email})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-label">Label (optional)</Label>
              <Input
                id="user-label"
                placeholder="e.g., Primary, On-Call"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <Button
              onClick={handleAddUserContact}
              disabled={!selectedUserId || addContactMutation.isPending}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add User Contact
            </Button>
          </TabPanel>
        )}

        <TabPanel id="mailbox" activeTab={activeTab} className="space-y-3 pt-3">
          <div className="space-y-2">
            <Label htmlFor="mailbox-email">Email Address</Label>
            <Input
              id="mailbox-email"
              type="email"
              placeholder="team@example.com"
              value={mailboxEmail}
              onChange={(e) => setMailboxEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mailbox-label">Label (optional)</Label>
            <Input
              id="mailbox-label"
              placeholder="e.g., Support, Escalation"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <Button
            onClick={handleAddMailboxContact}
            disabled={!mailboxEmail.trim() || addContactMutation.isPending}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Mailbox Contact
          </Button>
        </TabPanel>
      </div>
    </div>
  );
};
